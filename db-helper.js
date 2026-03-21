// db-helper.js — wrapper compatible con sql.js para Railway
const path = require('path');
const fs = require('fs');

class SqliteDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    try {
      // Intentar con better-sqlite3 primero (local)
      const Database = require('better-sqlite3');
      this._db = new Database(dbPath);
      this._type = 'better-sqlite3';
    } catch(e) {
      // Fallback a sql.js (Railway)
      const initSqlJs = require('sql.js');
      const sqlJsPromise = initSqlJs();
      sqlJsPromise.then(SQL => {
        let buf;
        if (fs.existsSync(dbPath)) {
          buf = fs.readFileSync(dbPath);
          this._db = new SQL.Database(buf);
        } else {
          this._db = new SQL.Database();
        }
        this._type = 'sql.js';
        this._SQL = SQL;
        this._save();
      });
      // Sincronizar esperando la promesa
      this._type = 'sql.js-pending';
      this._sqlJsPromise = sqlJsPromise;
      this._dbPath = dbPath;
    }
  }

  _save() {
    if (this._type === 'sql.js' && this._db) {
      const data = this._db.export();
      fs.writeFileSync(this._dbPath, Buffer.from(data));
    }
  }

  run(sql, params = []) {
    if (this._type === 'better-sqlite3') {
      return this._db.prepare(sql).run(params);
    }
    if (this._type === 'sql.js') {
      this._db.run(sql, params);
      this._save();
    }
  }

  get(sql, params = []) {
    if (this._type === 'better-sqlite3') {
      return this._db.prepare(sql).get(params);
    }
    if (this._type === 'sql.js') {
      const stmt = this._db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row;
      }
      stmt.free();
      return null;
    }
    return null;
  }

  all(sql, params = []) {
    if (this._type === 'better-sqlite3') {
      return this._db.prepare(sql).all(params);
    }
    if (this._type === 'sql.js') {
      const results = this._db.exec(sql, params);
      if (!results.length) return [];
      const { columns, values } = results[0];
      return values.map(row => {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return obj;
      });
    }
    return [];
  }
}

module.exports = { SqliteDatabase };
