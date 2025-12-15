<h1 align="center">🤝 Contributing to Anchorr</h1>

<p align="center">
  Thank you for considering contributing to Anchorr! We appreciate all kinds of contributions, from bug reports to new features.
</p>

## 🎯 Ways to Contribute

### 🐛 Report Bugs

Found a bug? Please help us fix it!

**When reporting, include:**

- Clear, descriptive title
- Steps to reproduce the issue
- Expected vs. actual behavior
- Console logs/error messages
- Your environment (Node.js version, OS, etc.)
- Screenshots if applicable

[Open a bug report](https://github.com/nairdahh/anchorr/issues/new?labels=bug&template=bug_report.md)

### 💡 Suggest Features

Have an idea to improve Anchorr?

**Before submitting:**

- Check existing issues to avoid duplicates
- Provide a clear use case
- Explain the expected behavior
- Discuss the implementation approach

[Suggest a feature](https://github.com/nairdahh/anchorr/issues/new?labels=enhancement&template=feature_request.md)

### 📝 Improve Documentation

Help us improve README, guides, or inline code comments!

### 🌐 Add Translations

Anchorr supports multiple languages! Help make it accessible to more users by contributing translations.

**Currently supported languages:**
- English (en) - Base language
- German (de) - Fully translated

**How to add a new language:**

#### Step 1: Setup Translation Files

1. Copy `locales/template.json` to `locales/[language-code].json` (e.g., `locales/fr.json` for French)
2. Update the `_meta` section with your language information:
```json
{
  "_meta": {
    "language_name": "Français",
    "language_code": "fr",
    "contributors": ["Your Name"],
    "completion": "0%",
    "last_updated": "2025-12-15",
    "notes": "French translation"
  }
}
```

#### Step 2: Translate Content

- Translate all empty string values in the JSON file
- Keep the structure identical to the template
- For HTML in translation values (like links), maintain the same HTML structure
- Test special characters and ensure proper encoding

#### Step 3: Update Language Selector

Add your language to the validation schema in `utils/validation.js`:
```javascript
LANGUAGE: Joi.string().valid("en", "de", "fr").optional(),
```

#### Step 4: Test Your Translation

1. Start Anchorr in development mode
2. Navigate to the authentication screen
3. Select your language from the dropdown
4. Verify all text displays correctly
5. Test the configuration interface
6. Check for text overflow or layout issues

**Translation Guidelines:**

- **Consistency**: Use the same terms throughout the interface
- **Context**: Consider the context where text appears (buttons, labels, help text)
- **Length**: Be mindful of text length - some languages are more verbose
- **Tone**: Maintain a helpful, professional tone
- **HTML**: Preserve HTML tags and structure in help text
- **Variables**: Keep placeholder variables like `{{title}}` unchanged

### 🔧 Submit Code Changes

We love pull requests! Here's how to submit one:

#### Step 1: Fork & Setup

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR-USERNAME/anchorr.git
cd anchorr
npm install
```

#### Step 2: Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# or for bugfixes:
git checkout -b fix/bug-description
```

#### Step 3: Make Changes & Commit

```bash
git add .
git commit -m "feat: add awesome feature"
# Use conventional commits:
# feat: new feature
# fix: bug fix
# docs: documentation
# style: formatting changes
# refactor: code refactoring
# test: adding tests
```

#### Step 4: Push & Create Pull Request

```bash
git push origin feature/your-feature-name
```

Then [open a PR](https://github.com/nairdahh/anchorr/compare) against the `main` branch.

#### PR Guidelines

- ✅ Keep PRs focused on a single feature/fix
- ✅ Write clear commit messages
- ✅ Update README if adding new features
- ✅ Test locally before submitting
- ✅ Link related issues

## 💬 Communication

- **Questions?** Open an issue with the `question` label
- **Discussion?** Start a GitHub Discussion
- **Need help?** Check existing documentation or issues first
