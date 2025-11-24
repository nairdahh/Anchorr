import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import logger from './logger.js';

const CONFIG_PATH = fs.existsSync("/config")
  ? path.join("/config", "config.json")
  : path.join(process.cwd(), "config.json");

// Generate or retrieve JWT_SECRET
function getOrGenerateJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // Try to load from config file
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(rawData);
      if (config.JWT_SECRET && config.JWT_SECRET.trim() !== '') {
        return config.JWT_SECRET;
      }
    } catch (error) {
      logger.error("Error reading JWT_SECRET from config:", error);
    }
  }

  // Generate a new secure JWT secret
  logger.warn("JWT_SECRET not found in config. Generating a new secure secret...");
  const newSecret = crypto.randomBytes(64).toString('hex');

  try {
    // Save the generated secret to config
    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      config = JSON.parse(rawData);
    }

    config.JWT_SECRET = newSecret;

    // Ensure config directory exists
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    logger.info("JWT_SECRET generated and saved to config.json successfully");
  } catch (error) {
    logger.error("Failed to save JWT_SECRET to config:", error);
    logger.warn("Using in-memory JWT_SECRET - sessions will not persist across restarts");
  }

  return newSecret;
}

const JWT_SECRET = getOrGenerateJwtSecret();

// Helper to get users from config
function getUsers() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      const config = JSON.parse(rawData);
      return config.USERS || [];
    } catch (error) {
      logger.error("Error reading config for users:", error);
      return [];
    }
  }
  return [];
}

// Helper to save user to config
function saveUser(username, passwordHash) {
  try {
    let config = {};
    if (fs.existsSync(CONFIG_PATH)) {
      const rawData = fs.readFileSync(CONFIG_PATH, "utf-8");
      config = JSON.parse(rawData);
    }

    if (!config.USERS) {
      config.USERS = [];
    }

    const newUser = {
      id: Date.now().toString(),
      username,
      password: passwordHash,
      createdAt: new Date().toISOString()
    };

    config.USERS.push(newUser);

    // Ensure /config directory exists
    const configDir = path.dirname(CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o777 });
    }
    
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    return newUser;
  } catch (error) {
    logger.error("Error saving user:", error);
    throw new Error("Failed to save user");
  }
}

export const authenticateToken = (req, res, next) => {
  const token = req.cookies.auth_token;

  if (!token) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    req.user = user;
    next();
  });
};

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required" });
  }

  const users = getUsers();
  const user = users.find(u => u.username === username);

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: "Invalid credentials" });
  }

  const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  res.json({ success: true, message: "Logged in successfully", username: user.username });
};

export const register = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required" });
  }

  const users = getUsers();
  
  // For now, only allow registration if no users exist (Single User Mode / First Run)
  if (users.length > 0) {
    return res.status(403).json({ success: false, message: "Registration is disabled. An admin account already exists." });
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  try {
    saveUser(username, hashedPassword);
    
    // Auto-login after register
    const newUser = getUsers().find(u => u.username === username);
    const token = jwt.sign({ id: newUser.id, username: newUser.username }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({ success: true, message: "Account created successfully", username: newUser.username });
  } catch (error) {
    res.status(500).json({ success: false, message: "Error creating account" });
  }
};

export const logout = (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: "Logged out successfully" });
};

export const checkAuth = (req, res) => {
  const token = req.cookies.auth_token;
  if (!token) {
    // Check if any users exist to determine if we should show register or login
    const users = getUsers();
    return res.json({ isAuthenticated: false, hasUsers: users.length > 0 });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      const users = getUsers();
      return res.json({ isAuthenticated: false, hasUsers: users.length > 0 });
    }
    res.json({ isAuthenticated: true, user });
  });
};
