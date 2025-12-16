/**
 * Tests for lost.js core framework.
 */
import { describe, it, beforeEach, afterEach, assert } from './test-runner.js';
import { Lost } from '/lost.js';

// Mock localStorage for testing
const mockStorage = {
  _data: {},
  getItem(key) { return this._data[key] ?? null; },
  setItem(key, val) { this._data[key] = val; },
  removeItem(key) { delete this._data[key]; },
  clear() { this._data = {}; }
};

// Replace window.localStorage for tests
const originalLocalStorage = window.localStorage;

describe('Lost - Static Utilities', () => {
  it('generateId creates unique IDs with correct format', () => {
    const id1 = Lost.generateId();
    const id2 = Lost.generateId();
    
    assert.ok(id1.startsWith('item_'), 'ID should start with item_');
    assert.notEqual(id1, id2, 'IDs should be unique');
    assert.ok(id1.length > 15, 'ID should have reasonable length');
  });

  it('deepEqual compares primitives correctly', () => {
    assert.ok(Lost.deepEqual(1, 1), 'Same numbers should be equal');
    assert.ok(Lost.deepEqual('a', 'a'), 'Same strings should be equal');
    assert.ok(!Lost.deepEqual(1, 2), 'Different numbers should not be equal');
    assert.ok(!Lost.deepEqual('a', 'b'), 'Different strings should not be equal');
  });

  it('deepEqual compares objects correctly', () => {
    assert.ok(Lost.deepEqual({a: 1}, {a: 1}), 'Same objects should be equal');
    assert.ok(!Lost.deepEqual({a: 1}, {a: 2}), 'Different values should not be equal');
    assert.ok(!Lost.deepEqual({a: 1}, {b: 1}), 'Different keys should not be equal');
    assert.ok(!Lost.deepEqual({a: 1}, {a: 1, b: 2}), 'Extra keys should not be equal');
  });

  it('deepEqual compares nested objects correctly', () => {
    const obj1 = { a: { b: { c: 1 } } };
    const obj2 = { a: { b: { c: 1 } } };
    const obj3 = { a: { b: { c: 2 } } };
    
    assert.ok(Lost.deepEqual(obj1, obj2), 'Same nested objects should be equal');
    assert.ok(!Lost.deepEqual(obj1, obj3), 'Different nested values should not be equal');
  });

  it('deepEqual handles null and undefined', () => {
    assert.ok(Lost.deepEqual(null, null), 'null === null');
    assert.ok(!Lost.deepEqual(null, undefined), 'null !== undefined');
    assert.ok(!Lost.deepEqual({}, null), 'object !== null');
  });

  it('defaultFilter removes underscore-prefixed keys', () => {
    const data = {
      name: 'Test',
      _private: 'secret',
      nested: { value: 1, _hidden: 2 }
    };
    const filtered = Lost.defaultFilter(data);
    
    assert.equal(filtered.name, 'Test', 'Regular keys preserved');
    assert.equal(filtered._private, undefined, 'Underscore keys removed');
    assert.equal(filtered.nested.value, 1, 'Nested regular keys preserved');
    assert.equal(filtered.nested._hidden, undefined, 'Nested underscore keys removed');
  });

  it('defaultFilter handles arrays', () => {
    const data = [
      { name: 'a', _temp: 1 },
      { name: 'b', _temp: 2 }
    ];
    const filtered = Lost.defaultFilter(data);
    
    assert.equal(filtered.length, 2, 'Array length preserved');
    assert.equal(filtered[0].name, 'a', 'Array items preserved');
    assert.equal(filtered[0]._temp, undefined, 'Underscore keys in arrays removed');
  });
});

describe('Lost - Constructor', () => {
  it('initializes with default values', () => {
    const lost = new Lost({});
    
    assert.equal(lost.storageKey, 'lost-store-v1', 'Default storage key');
    assert.equal(lost.currentKey, 'lost-current-v1', 'Default current key');
    assert.equal(lost.compressionMethod, 'deflate', 'Default compression');
    assert.equal(lost.download, 'auto', 'Default download setting');
    assert.equal(lost.maxUrlSize, 8192, 'Default max URL size');
  });

  it('accepts custom configuration', () => {
    const lost = new Lost({
      storageKey: 'my-store',
      currentKey: 'my-current',
      compressionMethod: 'gzip',
      maxUrlSize: 4000
    });
    
    assert.equal(lost.storageKey, 'my-store');
    assert.equal(lost.currentKey, 'my-current');
    assert.equal(lost.compressionMethod, 'gzip');
    assert.equal(lost.maxUrlSize, 4000);
  });

  it('uses custom validator when provided', () => {
    const validator = (data) => data.valid === true;
    const lost = new Lost({ validator });
    
    assert.ok(lost.validator({ valid: true }), 'Validator accepts valid data');
    assert.ok(!lost.validator({ valid: false }), 'Validator rejects invalid data');
  });

  it('uses custom filter when provided', () => {
    const filter = (data) => ({ ...data, filtered: true });
    const lost = new Lost({ filter });
    
    const result = lost.filter({ name: 'test' });
    assert.equal(result.filtered, true, 'Custom filter applied');
    assert.equal(result.name, 'test', 'Original data preserved');
  });
});

describe('Lost - Encoding/Decoding', () => {
  let lost;

  beforeEach(() => {
    lost = new Lost({
      compressionMethod: 'deflate'
    });
  });

  it('encodes and decodes data correctly with deflate', async () => {
    const data = { title: 'Test Item', count: 42 };
    const encoded = await lost.encode(data);
    
    assert.ok(encoded, 'Encoding produces result');
    assert.ok(encoded.startsWith('!'), 'Deflate encoded starts with !');
    
    const decoded = await lost.decode(encoded);
    assert.deepEqual(decoded, data, 'Decoded matches original');
  });

  it('encodes and decodes with gzip', async () => {
    lost.compressionMethod = 'gzip';
    const data = { name: 'gzip test' };
    
    const encoded = await lost.encode(data);
    assert.ok(encoded.startsWith('$'), 'Gzip encoded starts with $');
    
    const decoded = await lost.decode(encoded);
    assert.deepEqual(decoded, data, 'Gzip decoded matches original');
  });

  it('encodes without compression', async () => {
    lost.compressionMethod = 'none';
    const data = { simple: true };
    
    const encoded = await lost.encode(data);
    assert.ok(!encoded.startsWith('!') && !encoded.startsWith('$'), 'No prefix for uncompressed');
    
    const decoded = await lost.decode(encoded);
    assert.deepEqual(decoded, data, 'Uncompressed decoded matches');
  });

  it('applies filter before encoding', async () => {
    const data = { public: 'visible', _private: 'hidden' };
    const encoded = await lost.encode(data);
    const decoded = await lost.decode(encoded);
    
    assert.equal(decoded.public, 'visible', 'Public data preserved');
    assert.equal(decoded._private, undefined, 'Private data filtered');
  });

  it('validates on decode', async () => {
    const validLost = new Lost({
      validator: (data) => data.valid === true
    });

    const data = { valid: false };
    const encoded = await validLost.encode(data);
    const decoded = await validLost.decode(encoded);
    
    assert.isNull(decoded, 'Invalid data returns null');
  });
});

describe('Lost - CRUD Operations', () => {
  let lost;
  const testKey = 'test-crud-' + Date.now();

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    lost = new Lost({
      storageKey: testKey,
      currentKey: testKey + '-current',
      defaultData: { title: 'Default', count: 0 }
    });
    
    // Initialize without hash handling
    lost.items = {};
    lost.currentId = null;
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('create adds new item and sets as current', () => {
    const id = lost.create({ title: 'New Item', count: 1 });
    
    assert.ok(id, 'Create returns ID');
    assert.equal(lost.currentId, id, 'New item set as current');
    assert.equal(lost.items[id].title, 'New Item', 'Item data stored');
  });

  it('getItem retrieves by ID', () => {
    const id = lost.create({ title: 'Get Test' });
    const item = lost.getItem(id);
    
    assert.notNull(item, 'Item retrieved');
    assert.equal(item.title, 'Get Test', 'Correct item returned');
  });

  it('getCurrent returns active item', () => {
    lost.create({ title: 'First' });
    lost.create({ title: 'Second' });
    
    const current = lost.getCurrent();
    assert.equal(current.title, 'Second', 'Most recent is current');
  });

  it('getAll returns all items', () => {
    lost.create({ title: 'A' });
    lost.create({ title: 'B' });
    
    const all = lost.getAll();
    const count = Object.keys(all).length;
    
    assert.equal(count, 2, 'All items returned');
  });

  it('update modifies existing item', () => {
    const id = lost.create({ title: 'Original', count: 1 });
    lost.update(id, { count: 5 });
    
    const item = lost.getItem(id);
    assert.equal(item.title, 'Original', 'Unchanged fields preserved');
    assert.equal(item.count, 5, 'Updated field changed');
  });

  it('setCurrent switches active item', () => {
    const id1 = lost.create({ title: 'First' });
    const id2 = lost.create({ title: 'Second' });
    
    lost.setCurrent(id1);
    assert.equal(lost.currentId, id1, 'Current switched');
    assert.equal(lost.getCurrent().title, 'First', 'Correct item active');
  });

  it('delete removes item', () => {
    const id1 = lost.create({ title: 'Keep' });
    const id2 = lost.create({ title: 'Delete' });
    
    const result = lost.delete(id2);
    
    assert.ok(result, 'Delete returns true');
    assert.isNull(lost.getItem(id2), 'Item removed');
    assert.notNull(lost.getItem(id1), 'Other item preserved');
  });

  it('delete prevents removing last item', () => {
    const id = lost.create({ title: 'Only One' });
    const result = lost.delete(id);
    
    assert.ok(!result, 'Delete returns false');
    assert.notNull(lost.getItem(id), 'Item still exists');
  });

  it('delete switches current if needed', () => {
    const id1 = lost.create({ title: 'First' });
    const id2 = lost.create({ title: 'Second' });
    
    // id2 is current
    lost.delete(id2);
    
    assert.equal(lost.currentId, id1, 'Current switched after delete');
  });
});

describe('Lost - Share Status', () => {
  it('getShareStatus respects urlShare setting', () => {
    const lost = new Lost({ urlShare: 'no' });
    const status = lost.getShareStatus(100);
    
    assert.ok(!status.canShare, 'URL sharing disabled');
  });

  it('getShareStatus respects maxUrlSize', () => {
    const lost = new Lost({ maxUrlSize: 1000, urlShare: 'auto' });
    
    const small = lost.getShareStatus(500);
    assert.ok(small.canShare, 'Small content can share');
    assert.ok(!small.offerDownload, 'No download for small');
    
    const large = lost.getShareStatus(2000);
    assert.ok(!large.canShare, 'Large content cannot share');
    assert.ok(large.offerDownload, 'Download offered for large');
  });

  it('getShareStatus respects download setting', () => {
    const lost = new Lost({ download: 'yes' });
    const status = lost.getShareStatus(100);
    
    assert.ok(status.offerDownload, 'Download always offered');
  });
});

describe('Lost - Events', () => {
  let lost;

  beforeEach(() => {
    mockStorage.clear();
    Object.defineProperty(window, 'localStorage', { value: mockStorage, writable: true });
    
    lost = new Lost({
      storageKey: 'test-events-' + Date.now(),
      defaultData: { title: 'Test' }
    });
    lost.items = {};
  });

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: originalLocalStorage, writable: true });
  });

  it('dispatches update event on notify', (done) => {
    lost.create({ title: 'Event Test' });
    
    lost.addEventListener('update', (e) => {
      assert.notNull(e.detail, 'Event has detail');
      assert.equal(e.detail.title, 'Event Test', 'Correct data in event');
      done();
    });
    
    lost.notify();
  });

  it('update triggers notify by default', (done) => {
    const id = lost.create({ title: 'Notify Test' });
    
    lost.addEventListener('update', (e) => {
      if (e.detail.title === 'Updated') {
        assert.ok(true, 'Update triggered notify');
        done();
      }
    });
    
    lost.update(id, { title: 'Updated' });
  });

  it('update can skip notify', () => {
    const id = lost.create({ title: 'Silent' });
    let notified = false;
    
    lost.addEventListener('update', () => { notified = true; });
    lost.update(id, { title: 'Changed' }, false);
    
    // Give time for async
    assert.ok(!notified, 'Notify skipped when false');
  });
});
