/*
 * 원고 저장소: 브라우저 안의 IndexedDB에 저장한다 (인터넷으로 보내지 않음).
 * IndexedDB를 못 쓰는 환경이면 localStorage로 대신한다.
 */
(function (root) {
  'use strict';
  var DB_NAME = 'book-editor', STORE = 'kv', KEY = 'book';
  var dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error('no indexedDB'));
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        r.onsuccess = function () { resolve(r.result); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function idbSet(key, val) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(val, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var Storage = {
    mode: 'indexeddb',
    load: function () {
      return idbGet(KEY).then(function (v) {
        if (v) return v;
        // 예전에 localStorage에 저장된 것이 있으면 가져옴
        try { var s = localStorage.getItem('book-editor:' + KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
      }).catch(function () {
        Storage.mode = 'localstorage';
        try { var s = localStorage.getItem('book-editor:' + KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
      });
    },
    save: function (data) {
      if (Storage.mode === 'indexeddb') {
        return idbSet(KEY, data).catch(function (err) {
          Storage.mode = 'localstorage';
          return Storage.save(data);
        });
      }
      try {
        localStorage.setItem('book-editor:' + KEY, JSON.stringify(data));
        return Promise.resolve();
      } catch (e) { return Promise.reject(e); }
    },
    // 브라우저가 공간이 부족할 때 원고를 지우지 않도록 '영구 저장'을 요청
    persist: function () {
      if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () { return false; });
      return Promise.resolve(false);
    }
  };
  root.BookStorage = Storage;
})(this);
