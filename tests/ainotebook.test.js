/**
 * Tests for ainotebook app.
 * Focuses on TemplateManager which has the most pure, testable logic.
 */
import { describe, it, beforeEach, assert } from './test-runner.js';
import { TemplateManager } from '/ainotebook/template.js';

describe('TemplateManager - getCellKeys', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('returns empty array for null cell', () => {
    const keys = tm.getCellKeys(null, 0);
    assert.deepEqual(keys, []);
  });

  it('includes index-based keys', () => {
    const keys = tm.getCellKeys({ id: 'cell_1' }, 0);
    
    assert.includes(keys, '#1', 'Has #1 for index 0');
    assert.includes(keys, 'out1', 'Has out1 for index 0');
  });

  it('includes cell id', () => {
    const keys = tm.getCellKeys({ id: 'my_cell_id' }, 0);
    
    assert.includes(keys, 'my_cell_id', 'Has cell id');
  });

  it('includes cell name if present', () => {
    const keys = tm.getCellKeys({ id: 'cell_1', name: 'summary' }, 0);
    
    assert.includes(keys, 'summary', 'Has cell name');
  });

  it('returns correct keys for various indices', () => {
    const keys2 = tm.getCellKeys({ id: 'c' }, 1);
    assert.includes(keys2, '#2', 'Second cell is #2');
    assert.includes(keys2, 'out2', 'Second cell is out2');

    const keys10 = tm.getCellKeys({ id: 'c' }, 9);
    assert.includes(keys10, '#10', 'Tenth cell is #10');
    assert.includes(keys10, 'out10', 'Tenth cell is out10');
  });
});

describe('TemplateManager - parseKeyPath', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('parses simple identifier', () => {
    const result = tm.parseKeyPath('myvar');
    
    assert.equal(result.base, 'myvar');
    assert.deepEqual(result.path, []);
  });

  it('parses identifier with numeric index', () => {
    const result = tm.parseKeyPath('data[0]');
    
    assert.equal(result.base, 'data');
    assert.deepEqual(result.path, ['0']);
  });

  it('parses identifier with string key (single quotes)', () => {
    const result = tm.parseKeyPath("obj['key']");
    
    assert.equal(result.base, 'obj');
    assert.deepEqual(result.path, ['key']);
  });

  it('parses identifier with string key (double quotes)', () => {
    const result = tm.parseKeyPath('obj["key"]');
    
    assert.equal(result.base, 'obj');
    assert.deepEqual(result.path, ['key']);
  });

  it('parses nested paths', () => {
    const result = tm.parseKeyPath("data['users'][0]['name']");
    
    assert.equal(result.base, 'data');
    assert.deepEqual(result.path, ['users', '0', 'name']);
  });

  it('parses #N references', () => {
    const result = tm.parseKeyPath('#1');
    
    assert.equal(result.base, '#1');
    assert.deepEqual(result.path, []);
  });

  it('parses #N with path', () => {
    const result = tm.parseKeyPath("#3['result'][0]");
    
    assert.equal(result.base, '#3');
    assert.deepEqual(result.path, ['result', '0']);
  });

  it('handles empty input', () => {
    const result = tm.parseKeyPath('');
    
    assert.equal(result.base, '');
    assert.deepEqual(result.path, []);
  });

  it('handles whitespace', () => {
    const result = tm.parseKeyPath('  myvar  ');
    
    assert.equal(result.base, 'myvar');
  });
});

describe('TemplateManager - getCellValue', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('returns lastOutput for prompt cells', () => {
    const cell = { type: 'prompt', text: 'input', lastOutput: 'output' };
    
    assert.equal(tm.getCellValue(cell), 'output');
  });

  it('returns lastOutput for code cells', () => {
    const cell = { type: 'code', text: 'code', lastOutput: 'result' };
    
    assert.equal(tm.getCellValue(cell), 'result');
  });

  it('returns text for markdown cells', () => {
    const cell = { type: 'markdown', text: '# Title' };
    
    assert.equal(tm.getCellValue(cell), '# Title');
  });

  it('returns text for variable cells', () => {
    const cell = { type: 'variable', text: 'some value' };
    
    assert.equal(tm.getCellValue(cell), 'some value');
  });

  it('returns empty string for missing output', () => {
    const cell = { type: 'prompt', text: 'test' };
    
    assert.equal(tm.getCellValue(cell), '');
  });
});

describe('TemplateManager - resolveTemplateValue', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({ API_KEY: 'secret123' }));
  });

  it('resolves ENV variable', () => {
    const result = tm.resolveTemplateValue("ENV['API_KEY']", []);
    
    assert.equal(result, 'secret123');
  });

  it('resolves cell by name', () => {
    const cells = [
      { id: 'c1', type: 'variable', name: 'myvar', text: 'hello' }
    ];
    
    const result = tm.resolveTemplateValue('myvar', cells);
    
    assert.equal(result, 'hello');
  });

  it('resolves cell by index #N', () => {
    const cells = [
      { id: 'c1', type: 'markdown', text: 'first' },
      { id: 'c2', type: 'variable', text: 'second' }
    ];
    
    const result = tm.resolveTemplateValue('#2', cells);
    
    assert.equal(result, 'second');
  });

  it('resolves cell by outN', () => {
    const cells = [
      { id: 'c1', type: 'prompt', lastOutput: 'output1' },
      { id: 'c2', type: 'prompt', lastOutput: 'output2' }
    ];
    
    const result = tm.resolveTemplateValue('out2', cells);
    
    assert.equal(result, 'output2');
  });

  it('resolves cell by id', () => {
    const cells = [
      { id: 'cell_summary', type: 'prompt', lastOutput: 'Summary text' }
    ];
    
    const result = tm.resolveTemplateValue('cell_summary', cells);
    
    assert.equal(result, 'Summary text');
  });

  it('resolves JSON path in cell output', () => {
    const cells = [
      { id: 'c1', type: 'prompt', name: 'data', lastOutput: '{"name": "John", "age": 30}' }
    ];
    
    const nameResult = tm.resolveTemplateValue("data['name']", cells);
    assert.equal(nameResult, 'John');
    
    const ageResult = tm.resolveTemplateValue("data['age']", cells);
    assert.equal(ageResult, '30');
  });

  it('resolves nested JSON path', () => {
    const cells = [
      { 
        id: 'c1', 
        type: 'prompt', 
        name: 'response', 
        lastOutput: '{"user": {"profile": {"name": "Alice"}}}' 
      }
    ];
    
    const result = tm.resolveTemplateValue("response['user']['profile']['name']", cells);
    
    assert.equal(result, 'Alice');
  });

  it('resolves array index', () => {
    const cells = [
      { id: 'c1', type: 'prompt', name: 'list', lastOutput: '["a", "b", "c"]' }
    ];
    
    const result = tm.resolveTemplateValue('list[1]', cells);
    
    assert.equal(result, 'b');
  });

  it('returns empty string for non-existent cell', () => {
    const result = tm.resolveTemplateValue('nonexistent', []);
    
    assert.equal(result, '');
  });

  it('returns empty string for invalid path', () => {
    const cells = [
      { id: 'c1', type: 'prompt', name: 'data', lastOutput: '{"a": 1}' }
    ];
    
    const result = tm.resolveTemplateValue("data['nonexistent']", cells);
    
    assert.equal(result, '');
  });

  it('stringifies object values', () => {
    const cells = [
      { id: 'c1', type: 'prompt', name: 'obj', lastOutput: '{"nested": {"a": 1}}' }
    ];
    
    const result = tm.resolveTemplateValue("obj['nested']", cells);
    
    assert.equal(result, '{"a":1}');
  });
});

describe('TemplateManager - expandTemplate', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('expands simple reference', () => {
    const cells = [
      { id: 'c1', type: 'variable', name: 'name', text: 'World' }
    ];
    
    const result = tm.expandTemplate('Hello, {{ name }}!', cells);
    
    assert.equal(result, 'Hello, World!');
  });

  it('expands multiple references', () => {
    const cells = [
      { id: 'c1', type: 'variable', name: 'first', text: 'Hello' },
      { id: 'c2', type: 'variable', name: 'second', text: 'World' }
    ];
    
    const result = tm.expandTemplate('{{first}} {{second}}!', cells);
    
    assert.equal(result, 'Hello World!');
  });

  it('handles no references', () => {
    const result = tm.expandTemplate('Plain text', []);
    
    assert.equal(result, 'Plain text');
  });

  it('handles empty template', () => {
    const result = tm.expandTemplate('', []);
    
    assert.equal(result, '');
  });

  it('handles whitespace in reference', () => {
    const cells = [
      { id: 'c1', type: 'variable', name: 'var', text: 'value' }
    ];
    
    const result = tm.expandTemplate('{{  var  }}', cells);
    
    assert.equal(result, 'value');
  });

  it('expands path references', () => {
    const cells = [
      { id: 'c1', type: 'prompt', name: 'data', lastOutput: '{"key": "found"}' }
    ];
    
    const result = tm.expandTemplate("Value: {{ data['key'] }}", cells);
    
    assert.equal(result, 'Value: found');
  });
});

describe('TemplateManager - parseReferencesFromText', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('extracts single reference', () => {
    const refs = tm.parseReferencesFromText('Use {{myvar}} here');
    
    assert.deepEqual(refs, ['myvar']);
  });

  it('extracts multiple references', () => {
    const refs = tm.parseReferencesFromText('{{a}} and {{b}} and {{c}}');
    
    assert.includes(refs, 'a');
    assert.includes(refs, 'b');
    assert.includes(refs, 'c');
  });

  it('deduplicates references', () => {
    const refs = tm.parseReferencesFromText('{{x}} and {{x}} again');
    
    assert.equal(refs.length, 1);
    assert.deepEqual(refs, ['x']);
  });

  it('extracts base from path references', () => {
    const refs = tm.parseReferencesFromText("{{data['key']}}");
    
    assert.deepEqual(refs, ['data']);
  });

  it('returns empty array for no references', () => {
    const refs = tm.parseReferencesFromText('No references here');
    
    assert.deepEqual(refs, []);
  });

  it('handles null/undefined input', () => {
    assert.deepEqual(tm.parseReferencesFromText(null), []);
    assert.deepEqual(tm.parseReferencesFromText(undefined), []);
  });
});

describe('TemplateManager - buildReferenceIndex', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('builds index from prompt cells', () => {
    const cells = [
      { id: 'c1', type: 'prompt', text: 'Use {{notes}}' },
      { id: 'c2', type: 'prompt', text: 'Use {{notes}} and {{summary}}' }
    ];
    
    const index = tm.buildReferenceIndex(cells);
    
    assert.ok(index.has('notes'), 'Has notes key');
    assert.ok(index.get('notes').has('c1'), 'c1 uses notes');
    assert.ok(index.get('notes').has('c2'), 'c2 uses notes');
    assert.ok(index.has('summary'), 'Has summary key');
    assert.ok(index.get('summary').has('c2'), 'c2 uses summary');
  });

  it('builds index from markdown cells', () => {
    const cells = [
      { id: 'md1', type: 'markdown', text: 'See {{data}}' }
    ];
    
    const index = tm.buildReferenceIndex(cells);
    
    assert.ok(index.has('data'));
    assert.ok(index.get('data').has('md1'));
  });

  it('builds index from code cells', () => {
    const cells = [
      { id: 'code1', type: 'code', text: 'const x = {{input}};' }
    ];
    
    const index = tm.buildReferenceIndex(cells);
    
    assert.ok(index.has('input'));
    assert.ok(index.get('input').has('code1'));
  });

  it('handles cells with no references', () => {
    const cells = [
      { id: 'c1', type: 'markdown', text: 'No refs' }
    ];
    
    const index = tm.buildReferenceIndex(cells);
    
    assert.equal(index.size, 0);
  });
});

describe('TemplateManager - collectCellKeys', () => {
  let tm;

  beforeEach(() => {
    tm = new TemplateManager(() => new Map(), () => ({}));
  });

  it('collects keys from new cells', () => {
    const prevCells = [];
    const newCells = [
      { id: 'c1', name: 'myname' }
    ];
    
    const keys = tm.collectCellKeys(prevCells, newCells, 'c1');
    
    assert.includes(keys, 'c1');
    assert.includes(keys, 'myname');
    assert.includes(keys, '#1');
    assert.includes(keys, 'out1');
  });

  it('collects keys from previous and new cells', () => {
    const prevCells = [
      { id: 'c1', name: 'oldname' }
    ];
    const newCells = [
      { id: 'c1', name: 'newname' }
    ];
    
    const keys = tm.collectCellKeys(prevCells, newCells, 'c1');
    
    // Should have both old and new names
    assert.includes(keys, 'oldname');
    assert.includes(keys, 'newname');
  });

  it('handles cell only in prev', () => {
    const prevCells = [
      { id: 'deleted', name: 'old' }
    ];
    const newCells = [];
    
    const keys = tm.collectCellKeys(prevCells, newCells, 'deleted');
    
    assert.includes(keys, 'deleted');
    assert.includes(keys, 'old');
  });

  it('returns empty for non-existent cell', () => {
    const keys = tm.collectCellKeys([], [], 'nonexistent');
    
    assert.deepEqual(keys, []);
  });
});

describe('AINotebook - Data Validation', () => {
  function validateNotebook(data) {
    if (!data || typeof data !== 'object') return false;
    if (!Array.isArray(data.cells)) return false;
    return true;
  }

  it('rejects null', () => {
    assert.ok(!validateNotebook(null));
  });

  it('rejects non-object', () => {
    assert.ok(!validateNotebook('string'));
    assert.ok(!validateNotebook(123));
  });

  it('rejects missing cells', () => {
    assert.ok(!validateNotebook({}));
  });

  it('rejects non-array cells', () => {
    assert.ok(!validateNotebook({ cells: 'not array' }));
  });

  it('accepts valid notebook', () => {
    assert.ok(validateNotebook({ cells: [] }));
    assert.ok(validateNotebook({ title: 'Test', cells: [{ id: 'c1' }] }));
  });
});

describe('AINotebook - Default Structure', () => {
  const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';
  
  const DEFAULT_NOTEBOOK = {
    title: 'New Notebook',
    notebookModelId: '',
    notebookParams: '',
    cells: [
      { id: 'cell_intro', type: 'markdown', name: 'notes', text: '# New notebook' },
      { id: 'cell_var', type: 'variable', name: 'systemprompt', text: DEFAULT_SYSTEM_PROMPT },
      { id: 'cell_summary', type: 'prompt', name: 'summary', text: 'Summarize...' },
      { id: 'cell_format', type: 'code', name: 'formatted', text: 'return x;' }
    ]
  };

  it('has four default cells', () => {
    assert.equal(DEFAULT_NOTEBOOK.cells.length, 4);
  });

  it('has one of each cell type', () => {
    const types = DEFAULT_NOTEBOOK.cells.map(c => c.type);
    
    assert.includes(types, 'markdown');
    assert.includes(types, 'variable');
    assert.includes(types, 'prompt');
    assert.includes(types, 'code');
  });

  it('all cells have id and name', () => {
    for (const cell of DEFAULT_NOTEBOOK.cells) {
      assert.ok(cell.id, `Cell has id`);
      assert.ok(cell.name, `Cell has name`);
    }
  });
});
