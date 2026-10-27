import assert from 'node:assert/strict';
import test from 'node:test';
import { newMailButtons } from './owa-compose.mjs';

function button(label, tooltip = '', options = {}) {
  return {
    disabled: false,
    getAttribute: name => ({'aria-label': label, customtooltip: tooltip, ...options.attributes})[name] ?? null,
    getBoundingClientRect: () => ({width: 80, height: 24}),
    ...options,
  };
}

test('compose control supports the old label and the current mail ribbon', () => {
  const old = button('New mail');
  const ribbon = button('New', 'Create a new email message. (N)');
  for (const control of [old, ribbon]) {
    assert.deepEqual(newMailButtons({querySelectorAll: () => [control]}), [control]);
  }
});

test('compose selector scopes generic New to the ribbon and verifies its mail tooltip', () => {
  const unrelated = button('New', 'Create a calendar event');
  assert.deepEqual(newMailButtons({querySelectorAll: selector => {
    assert.equal(selector, 'button[aria-label="New mail"],[role="toolbar"] button[aria-label="New"]');
    return [unrelated];
  }}), []);
});

test('compose selection excludes hidden and disabled controls without hiding ambiguity', () => {
  const first = button('New mail'), second = button('New', 'Create a new email message. (N)');
  const hidden = button('New mail', '', {getBoundingClientRect: () => ({width: 0, height: 0})});
  const disabled = button('New mail', '', {disabled: true});
  const ariaDisabled = button('New mail', '', {attributes: {'aria-disabled': 'true'}});
  assert.deepEqual(newMailButtons({querySelectorAll: () => [hidden, disabled, ariaDisabled, first, second]}), [first, second]);
});
