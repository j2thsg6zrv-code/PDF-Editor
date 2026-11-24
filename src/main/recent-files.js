const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 15;

/**
 * The app's own Open Recent list, kept in a small JSON file in the user-data folder.
 * The operating system's list (macOS's recent documents, Windows jump lists) is unreliable
 * for an unsigned app and does not exist as a menu on Windows, so the menu reads from this.
 */
class RecentFiles {
  constructor(storeFile) {
    this.storeFile = storeFile;
    this.paths = [];
    try {
      const saved = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
      if (Array.isArray(saved)) this.paths = saved.filter((p) => typeof p === 'string').slice(0, MAX_ENTRIES);
    } catch {
      // No list yet, or an unreadable one: start empty.
    }
  }

  /** Moves the file to the top of the list. Returns true when the list changed. */
  add(filePath) {
    const resolved = path.resolve(filePath);
    const before = this.paths.join('\n');
    this.paths = [resolved, ...this.paths.filter((p) => !samePath(p, resolved))].slice(0, MAX_ENTRIES);
    if (this.paths.join('\n') === before) return false;
    this.save();
    return true;
  }

  remove(filePath) {
    const count = this.paths.length;
    this.paths = this.paths.filter((p) => !samePath(p, filePath));
    if (this.paths.length !== count) this.save();
  }

  clear() {
    this.paths = [];
    this.save();
  }

  /** The files that still exist, newest first. */
  list() {
    return this.paths.filter((p) => fs.existsSync(p));
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
      fs.writeFileSync(this.storeFile, JSON.stringify(this.paths, null, 2));
    } catch (err) {
      console.error('Could not save the recent files list:', err);
    }
  }
}

// Windows and macOS file systems are case-insensitive by default.
function samePath(a, b) {
  return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}

module.exports = { RecentFiles };
