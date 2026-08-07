import fs from "fs";
import path from "path";
import logger from "./logger.js";
import { CONFIG_PATH } from "./configFile.js";

const FLUSH_DEBOUNCE_MS = 2000;
// Failures beyond this count are treated as a standing condition, not a blip.
const PERSISTENT_FLUSH_FAILURE_THRESHOLD = 5;

const registry = new Set();
let shutdownHooksInstalled = false;

function installShutdownHooks() {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const flushAll = () => {
    for (const m of registry) {
      try {
        m.flush();
      } catch (err) {
        logger.warn(`PersistentMap shutdown flush failed: ${err?.message || err}`);
      }
    }
  };
  // Process termination is owned by app.js (which calls process.exit(0) after
  // server.close). These additional listeners run synchronously alongside it
  // to flush dirty state before exit; we deliberately do not call exit here
  // to avoid racing app.js's graceful shutdown.
  process.on("SIGTERM", flushAll);
  process.on("SIGINT", flushAll);
  process.on("beforeExit", flushAll);
}

/**
 * Map-like store with per-entry TTL that survives process restarts.
 *
 * Persists to a JSON file next to config.json. Mutations schedule a
 * debounced atomic write (tmp file + rename) so we don't thrash the disk
 * on bursty traffic. Expired entries are dropped lazily on access and
 * eagerly on load/cleanup.
 *
 * Used for dedup state — losing a few seconds of writes on hard crash
 * is acceptable; the worst outcome is one extra Discord notification.
 *
 * Options:
 *   - validateValue(value): optional predicate. Entries whose value fails
 *     the check are dropped on load (defends against tampered/corrupt files).
 */
export class PersistentMap {
  constructor(name, defaultTtlMs, options = {}) {
    this.name = name;
    this.defaultTtlMs = defaultTtlMs;
    this.validateValue = options.validateValue;
    this.filePath = path.join(path.dirname(CONFIG_PATH), `dedup-${name}.json`);
    this.entries = new Map();
    this.flushTimer = null;
    this.dirty = false;
    this.consecutiveFlushFailures = 0;
    this.loadFailed = false;
    this._load();
    registry.add(this);
    installShutdownHooks();
  }

  _quarantine(reason) {
    try {
      const dest = `${this.filePath}.corrupt-${Date.now()}`;
      fs.renameSync(this.filePath, dest);
      logger.warn(
        `PersistentMap[${this.name}]: quarantined corrupt file to ${dest} (${reason})`
      );
    } catch (err) {
      logger.warn(
        `PersistentMap[${this.name}]: failed to quarantine corrupt file (${err?.message || err})`
      );
    }
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return;
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, "utf-8");
    } catch (err) {
      // IO error — block flushing so the unread file isn't overwritten with
      // the empty in-memory state on the first set().
      this.loadFailed = true;
      logger.error(
        `PersistentMap[${this.name}]: read failed (${err?.message || err}). Dedup state is memory-only this run and will NOT be persisted; existing file left untouched. Fix the file/volume permissions and restart.`
      );
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this._quarantine(`parse error: ${err?.message || err}`);
      return;
    }
    if (!Array.isArray(parsed)) {
      this._quarantine("file content is not an array");
      return;
    }
    const now = Date.now();
    let loaded = 0;
    let dropped = 0;
    let invalid = 0;
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        invalid++;
        continue;
      }
      const { key, value, expiresAt } = entry;
      if (typeof key !== "string" || typeof expiresAt !== "number") {
        invalid++;
        continue;
      }
      if (expiresAt <= now) {
        dropped++;
        continue;
      }
      if (this.validateValue && !this.validateValue(value)) {
        invalid++;
        continue;
      }
      this.entries.set(key, { value, expiresAt });
      loaded++;
    }
    logger.info(
      `PersistentMap[${this.name}]: loaded ${loaded} entries from ${this.filePath} (dropped ${dropped} expired, ${invalid} invalid)`
    );
    if (invalid > 0) this._scheduleFlush(); // rewrite without bad entries
  }

  _scheduleFlush() {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), FLUSH_DEBOUNCE_MS);
  }

  /** @returns {boolean} true if state is on disk (or there was nothing to write). */
  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.loadFailed) return false;
    if (!this.dirty) return true;
    const now = Date.now();
    const data = [];
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) {
        data.push({ key, value: entry.value, expiresAt: entry.expiresAt });
      }
    }
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(tmpPath, this.filePath);
      this.dirty = false;
      if (this.consecutiveFlushFailures > 0) {
        logger.info(
          `PersistentMap[${this.name}]: flush recovered after ${this.consecutiveFlushFailures} failure(s)`
        );
        this.consecutiveFlushFailures = 0;
      }
      return true;
    } catch (err) {
      this.dirty = true;
      this.consecutiveFlushFailures++;
      // Rate-limited, but a persistent failure must not fade into debug —
      // unpersisted dedup state means the whole library is re-announced
      // after the next restart.
      const msg = `PersistentMap[${this.name}]: flush failed #${this.consecutiveFlushFailures} (${err?.message || err})`;
      if (this.consecutiveFlushFailures >= PERSISTENT_FLUSH_FAILURE_THRESHOLD) {
        if (this.consecutiveFlushFailures % 20 === 0 ||
            this.consecutiveFlushFailures === PERSISTENT_FLUSH_FAILURE_THRESHOLD) {
          logger.error(
            `${msg} — dedup state is not being persisted; notifications will duplicate after restart. Check disk space and volume permissions.`
          );
        } else {
          logger.debug(msg);
        }
      } else if (this.consecutiveFlushFailures === 1) {
        logger.warn(msg);
      } else {
        logger.debug(msg);
      }
      return false;
    }
  }

  has(key) {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this._scheduleFlush();
      return false;
    }
    return true;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      this._scheduleFlush();
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    const expiresAt = Date.now() + (ttlMs ?? this.defaultTtlMs);
    this.entries.set(key, { value, expiresAt });
    this._scheduleFlush();
  }

  delete(key) {
    if (this.entries.delete(key)) this._scheduleFlush();
  }

  cleanup() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed > 0) this._scheduleFlush();
    return removed;
  }

  /** Drop entries matching the predicate. Returns count removed. */
  prune(predicate) {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (predicate(key, entry.value)) {
        this.entries.delete(key);
        removed++;
      }
    }
    if (removed > 0) this._scheduleFlush();
    return removed;
  }

  /**
   * Rename a key without changing its value or expiresAt. If newKey already
   * exists the old entry is discarded (existing entry wins) and the old key is
   * removed. Returns true if oldKey existed.
   */
  rekey(oldKey, newKey) {
    const entry = this.entries.get(oldKey);
    if (!entry) return false;
    this.entries.delete(oldKey);
    if (!this.entries.has(newKey)) {
      this.entries.set(newKey, entry);
    } else {
      logger.info(`PersistentMap[${this.name}]: rekey collision — ${oldKey} → ${newKey} already exists, old entry discarded`);
    }
    this._scheduleFlush();
    return true;
  }

  /** Return all non-expired keys, evicting expired entries as a side effect (consistent with get/has). */
  keys() {
    const now = Date.now();
    const result = [];
    const expired = [];
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt > now) {
        result.push(key);
      } else {
        expired.push(key);
      }
    }
    if (expired.length > 0) {
      for (const key of expired) this.entries.delete(key);
      this._scheduleFlush();
    }
    return result;
  }

  size() {
    return this.entries.size;
  }
}
