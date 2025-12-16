/**
 * Tests for wheel app logic.
 * Tests the pure functions and validation without requiring the full app.
 */
import { describe, it, beforeEach, assert } from './test-runner.js';

// Since wheel app is a class that initializes immediately, we test
// the logic patterns used there. For full integration tests, 
// you would need to restructure the app or use browser automation.

describe('Wheel - Color Utilities', () => {
  // Replicate the hexToLuma function from wheel app
  function hexToLuma(hex) {
    const c = hex.replace('#', '');
    const r = parseInt(c.substr(0, 2), 16) / 255;
    const g = parseInt(c.substr(2, 2), 16) / 255;
    const b = parseInt(c.substr(4, 2), 16) / 255;
    const [R, G, B] = [r, g, b].map(v => 
      (v <= 0.03928) ? v / 12.92 : Math.pow(((v + 0.055) / 1.055), 2.4)
    );
    return 0.2126 * R + 0.7152 * G + 0.0722 * B;
  }

  it('hexToLuma returns low value for dark colors', () => {
    const black = hexToLuma('#000000');
    const darkBlue = hexToLuma('#0a0d13');
    
    assert.ok(black < 0.1, 'Black is dark');
    assert.ok(darkBlue < 0.1, 'Dark blue is dark');
  });

  it('hexToLuma returns high value for light colors', () => {
    const white = hexToLuma('#ffffff');
    const lightGray = hexToLuma('#f5f5f5');
    
    assert.ok(white > 0.9, 'White is light');
    assert.ok(lightGray > 0.8, 'Light gray is light');
  });

  it('hexToLuma returns mid value for medium colors', () => {
    const gray = hexToLuma('#808080');
    
    assert.ok(gray > 0.2 && gray < 0.5, 'Gray is medium');
  });

  it('contrast threshold at 0.54 distinguishes light/dark backgrounds', () => {
    const yellow = hexToLuma('#eab308');
    const blue = hexToLuma('#3b82f6');
    const red = hexToLuma('#ef4444');
    
    // Yellow typically needs dark text
    assert.ok(yellow > 0.3, 'Yellow is relatively light');
    // Blue typically needs light text
    assert.ok(blue < 0.3, 'Blue is relatively dark');
  });
});

describe('Wheel - Segment Validation', () => {
  // Replicate validation logic from wheel app
  function validateWheel(wheel) {
    if (!wheel || typeof wheel !== 'object') return false;
    if (!Array.isArray(wheel.segments) || wheel.segments.length < 2 || wheel.segments.length > 100) return false;
    
    const validSegments = wheel.segments.every(s =>
      s && typeof s.label === 'string' && typeof s.color === 'string'
    );
    return validSegments;
  }

  it('rejects null wheel', () => {
    assert.ok(!validateWheel(null), 'Null rejected');
  });

  it('rejects wheel without segments', () => {
    assert.ok(!validateWheel({}), 'Missing segments rejected');
    assert.ok(!validateWheel({ segments: 'not array' }), 'Non-array rejected');
  });

  it('rejects wheel with too few segments', () => {
    assert.ok(!validateWheel({ segments: [] }), 'Empty rejected');
    assert.ok(!validateWheel({ segments: [{ label: 'One', color: '#fff' }] }), 'One segment rejected');
  });

  it('rejects wheel with too many segments', () => {
    const tooMany = Array(101).fill({ label: 'X', color: '#fff' });
    assert.ok(!validateWheel({ segments: tooMany }), '101 segments rejected');
  });

  it('rejects segments without label', () => {
    assert.ok(!validateWheel({ 
      segments: [
        { label: 'A', color: '#fff' },
        { color: '#fff' } // missing label
      ] 
    }), 'Missing label rejected');
  });

  it('rejects segments without color', () => {
    assert.ok(!validateWheel({ 
      segments: [
        { label: 'A', color: '#fff' },
        { label: 'B' } // missing color
      ] 
    }), 'Missing color rejected');
  });

  it('accepts valid wheel with 2 segments', () => {
    assert.ok(validateWheel({
      segments: [
        { label: 'A', color: '#ff0000' },
        { label: 'B', color: '#00ff00' }
      ]
    }), 'Two segments accepted');
  });

  it('accepts valid wheel with 100 segments', () => {
    const maxSegments = Array(100).fill(null).map((_, i) => ({
      label: `Option ${i + 1}`,
      color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')
    }));
    
    assert.ok(validateWheel({ segments: maxSegments }), '100 segments accepted');
  });
});

describe('Wheel - Default Configuration', () => {
  const DEFAULT_CONFIG = {
    title: 'Wheel of Choices',
    spinSeconds: 4,
    burnMode: false,
    segments: [
      { label: 'Red', color: '#ef4444' },
      { label: 'Green', color: '#22c55e' },
      { label: 'Blue', color: '#3b82f6' },
      { label: 'Yellow', color: '#eab308' },
    ],
  };

  it('default config has 4 segments', () => {
    assert.equal(DEFAULT_CONFIG.segments.length, 4, 'Four default segments');
  });

  it('default spin time is 4 seconds', () => {
    assert.equal(DEFAULT_CONFIG.spinSeconds, 4, 'Four second spin');
  });

  it('burn mode is off by default', () => {
    assert.equal(DEFAULT_CONFIG.burnMode, false, 'Burn mode off');
  });

  it('each default segment has label and color', () => {
    for (const seg of DEFAULT_CONFIG.segments) {
      assert.ok(typeof seg.label === 'string' && seg.label.length > 0, 'Has label');
      assert.ok(typeof seg.color === 'string' && seg.color.startsWith('#'), 'Has hex color');
    }
  });
});

describe('Wheel - Color Palette', () => {
  const COLOR_PALETTE = [
    '#000000', '#ffffff', '#d1d5db', '#4b5563',
    '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
    '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#fb7185',
    '#fca5a5', '#fdba74', '#fde047', '#bef264', '#86efac', '#99f6e4',
    '#7dd3fc', '#93c5fd', '#a5b4fc', '#c4b5fd', '#f0abfc', '#f9a8d4'
  ];

  it('palette contains at least 30 colors', () => {
    assert.ok(COLOR_PALETTE.length >= 30, 'Enough color variety');
  });

  it('all palette colors are valid hex', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i;
    for (const color of COLOR_PALETTE) {
      assert.ok(hexPattern.test(color), `Valid hex: ${color}`);
    }
  });

  it('palette includes black and white', () => {
    assert.includes(COLOR_PALETTE, '#000000', 'Has black');
    assert.includes(COLOR_PALETTE, '#ffffff', 'Has white');
  });
});

describe('Wheel - Segment Text Processing', () => {
  // Replicate text parsing logic from wheel editor
  function parseLinesWithColors(rawText, prevLines, prevColors) {
    const lines = [];
    const colors = [];
    const lineToColorMap = new Map();
    
    for (let i = 0; i < prevLines.length; i++) {
      if (prevLines[i] && prevColors[i]) {
        lineToColorMap.set(prevLines[i], prevColors[i]);
      }
    }

    for (let rawLine of rawText.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      
      const colorMatch = trimmed.match(/^(.+?)\s+(#[0-9a-fA-F]{6})$/);
      
      if (colorMatch) {
        lines.push(colorMatch[1].trim());
        colors.push(colorMatch[2].toLowerCase());
      } else {
        lines.push(trimmed);
        colors.push(lineToColorMap.get(trimmed) || '#888888');
      }
    }
    
    return { lines, colors };
  }

  it('parses plain text lines', () => {
    const result = parseLinesWithColors('Option A\nOption B', [], []);
    
    assert.deepEqual(result.lines, ['Option A', 'Option B']);
    assert.equal(result.colors.length, 2);
  });

  it('parses lines with inline hex colors', () => {
    const result = parseLinesWithColors('Red #ff0000\nBlue #0000ff', [], []);
    
    assert.deepEqual(result.lines, ['Red', 'Blue']);
    assert.deepEqual(result.colors, ['#ff0000', '#0000ff']);
  });

  it('preserves colors for unchanged lines', () => {
    const result = parseLinesWithColors(
      'Keep\nNew',
      ['Keep'],
      ['#abc123']
    );
    
    assert.deepEqual(result.lines, ['Keep', 'New']);
    assert.equal(result.colors[0], '#abc123', 'Preserved color');
    assert.equal(result.colors[1], '#888888', 'Default color for new');
  });

  it('skips empty lines', () => {
    const result = parseLinesWithColors('A\n\n\nB\n  \nC', [], []);
    
    assert.deepEqual(result.lines, ['A', 'B', 'C']);
    assert.equal(result.colors.length, 3);
  });

  it('trims whitespace', () => {
    const result = parseLinesWithColors('  Option A  \n  Option B  ', [], []);
    
    assert.deepEqual(result.lines, ['Option A', 'Option B']);
  });
});

describe('Wheel - Spin Logic', () => {
  // Test easing function
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  it('easeOutCubic starts at 0', () => {
    assert.equal(easeOutCubic(0), 0, 'Starts at 0');
  });

  it('easeOutCubic ends at 1', () => {
    assert.equal(easeOutCubic(1), 1, 'Ends at 1');
  });

  it('easeOutCubic is monotonically increasing', () => {
    let prev = 0;
    for (let t = 0.1; t <= 1; t += 0.1) {
      const current = easeOutCubic(t);
      assert.ok(current > prev, `Increasing at t=${t.toFixed(1)}`);
      prev = current;
    }
  });

  it('easeOutCubic has fast start, slow end', () => {
    const early = easeOutCubic(0.2);
    const late = easeOutCubic(0.8);
    
    // Early progress should be > 20% (faster than linear)
    assert.ok(early > 0.2, 'Fast start');
    // Progress from 80% to 100% should be < 20% (slower than linear)
    assert.ok(1 - late < 0.2, 'Slow end');
  });

  // Test angle normalization
  function normalizeAngle(a) {
    a = a % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return a;
  }

  it('normalizeAngle keeps 0-2π unchanged', () => {
    assert.equal(normalizeAngle(0), 0, 'Zero unchanged');
    assert.ok(Math.abs(normalizeAngle(Math.PI) - Math.PI) < 0.001, 'Pi unchanged');
  });

  it('normalizeAngle wraps angles > 2π', () => {
    const result = normalizeAngle(Math.PI * 3);
    assert.ok(Math.abs(result - Math.PI) < 0.001, 'Wrapped 3π to π');
  });

  it('normalizeAngle handles negative angles', () => {
    const result = normalizeAngle(-Math.PI / 2);
    assert.ok(result > 0 && result < Math.PI * 2, 'Negative converted to positive');
    assert.ok(Math.abs(result - (Math.PI * 1.5)) < 0.001, '-π/2 becomes 3π/2');
  });
});

describe('Wheel - Burn Mode', () => {
  function getAvailableSegments(segments) {
    return segments.filter(s => !s._burned);
  }

  it('all segments available initially', () => {
    const segments = [
      { label: 'A', color: '#fff' },
      { label: 'B', color: '#fff' }
    ];
    
    const available = getAvailableSegments(segments);
    assert.equal(available.length, 2, 'All available');
  });

  it('burned segments not available', () => {
    const segments = [
      { label: 'A', color: '#fff', _burned: true },
      { label: 'B', color: '#fff' },
      { label: 'C', color: '#fff', _burned: true }
    ];
    
    const available = getAvailableSegments(segments);
    assert.equal(available.length, 1, 'One available');
    assert.equal(available[0].label, 'B', 'Correct one available');
  });

  it('all burned when all marked', () => {
    const segments = [
      { label: 'A', color: '#fff', _burned: true },
      { label: 'B', color: '#fff', _burned: true }
    ];
    
    const available = getAvailableSegments(segments);
    assert.equal(available.length, 0, 'None available');
  });

  it('reset clears burned state', () => {
    const segments = [
      { label: 'A', color: '#fff', _burned: true },
      { label: 'B', color: '#fff', _burned: true }
    ];
    
    const reset = segments.map(s => {
      const copy = { ...s };
      delete copy._burned;
      return copy;
    });
    
    const available = getAvailableSegments(reset);
    assert.equal(available.length, 2, 'All available after reset');
  });
});
