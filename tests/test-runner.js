/**
 * Lightweight browser-based test runner for LOST framework.
 * Zero dependencies, vanilla JS.
 */

export class TestRunner {
  constructor() {
    this.suites = [];
    this.currentSuite = null;
    this.results = { passed: 0, failed: 0, errors: [] };
  }

  /**
   * Define a test suite.
   * @param {string} name - Suite name.
   * @param {Function} fn - Function containing tests.
   */
  describe(name, fn) {
    this.currentSuite = { name, tests: [], beforeEach: null, afterEach: null };
    this.suites.push(this.currentSuite);
    fn();
    this.currentSuite = null;
  }

  /**
   * Setup run before each test in current suite.
   */
  beforeEach(fn) {
    if (this.currentSuite) this.currentSuite.beforeEach = fn;
  }

  /**
   * Cleanup run after each test in current suite.
   */
  afterEach(fn) {
    if (this.currentSuite) this.currentSuite.afterEach = fn;
  }

  /**
   * Define a test case.
   * @param {string} name - Test name.
   * @param {Function} fn - Test function (can be async).
   */
  it(name, fn) {
    if (this.currentSuite) {
      this.currentSuite.tests.push({ name, fn });
    }
  }

  /**
   * Run all registered suites and tests.
   * @returns {Promise<Object>} Results object.
   */
  async run() {
    this.results = { passed: 0, failed: 0, errors: [] };
    const output = [];

    for (const suite of this.suites) {
      output.push(`\n📦 ${suite.name}`);

      for (const test of suite.tests) {
        try {
          if (suite.beforeEach) await suite.beforeEach();
          await test.fn();
          if (suite.afterEach) await suite.afterEach();
          
          this.results.passed++;
          output.push(`  ✅ ${test.name}`);
        } catch (err) {
          this.results.failed++;
          const errMsg = err.message || String(err);
          this.results.errors.push({ suite: suite.name, test: test.name, error: errMsg });
          output.push(`  ❌ ${test.name}`);
          output.push(`     └─ ${errMsg}`);
        }
      }
    }

    this.results.output = output.join('\n');
    return this.results;
  }

  /**
   * Render results to a DOM element.
   * @param {HTMLElement} container 
   */
  renderTo(container) {
    const { passed, failed, output } = this.results;
    const total = passed + failed;
    const statusClass = failed === 0 ? 'pass' : 'fail';
    
    container.innerHTML = `
      <div class="test-summary ${statusClass}">
        <strong>${failed === 0 ? '✅ All tests passed!' : '❌ Some tests failed'}</strong>
        <span>${passed}/${total} passed</span>
      </div>
      <pre class="test-output">${this.escapeHtml(output)}</pre>
    `;
  }

  escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

// Assertion helpers
export const assert = {
  /**
   * Assert a condition is truthy.
   */
  ok(value, message = 'Expected value to be truthy') {
    if (!value) throw new Error(message);
  },

  /**
   * Assert strict equality.
   */
  equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  },

  /**
   * Assert deep equality for objects/arrays.
   */
  deepEqual(actual, expected, message) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
      throw new Error(message || `Deep equal failed:\n  Expected: ${expectedStr}\n  Actual: ${actualStr}`);
    }
  },

  /**
   * Assert a value is of given type.
   */
  isType(value, type, message) {
    const actualType = typeof value;
    if (actualType !== type) {
      throw new Error(message || `Expected type ${type}, got ${actualType}`);
    }
  },

  /**
   * Assert function throws.
   */
  throws(fn, message = 'Expected function to throw') {
    let threw = false;
    try { fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error(message);
  },

  /**
   * Assert async function throws.
   */
  async throwsAsync(fn, message = 'Expected async function to throw') {
    let threw = false;
    try { await fn(); } catch (e) { threw = true; }
    if (!threw) throw new Error(message);
  },

  /**
   * Assert array includes value.
   */
  includes(array, value, message) {
    if (!Array.isArray(array) || !array.includes(value)) {
      throw new Error(message || `Expected array to include ${JSON.stringify(value)}`);
    }
  },

  /**
   * Assert value is null or undefined.
   */
  isNull(value, message = 'Expected null or undefined') {
    if (value != null) throw new Error(message);
  },

  /**
   * Assert value is not null or undefined.
   */
  notNull(value, message = 'Expected value to not be null/undefined') {
    if (value == null) throw new Error(message);
  },

  /**
   * Assert two values are not equal.
   */
  notEqual(actual, expected, message) {
    if (actual === expected) {
      throw new Error(message || `Expected values to differ, both are ${JSON.stringify(actual)}`);
    }
  }
};

// Global test runner instance
export const runner = new TestRunner();

// Convenience exports for test files
export const describe = (name, fn) => runner.describe(name, fn);
export const it = (name, fn) => runner.it(name, fn);
export const beforeEach = (fn) => runner.beforeEach(fn);
export const afterEach = (fn) => runner.afterEach(fn);
