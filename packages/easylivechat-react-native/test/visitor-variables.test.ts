import { describe, expect, it } from 'vitest';

import { substituteVisitorVariables } from '../src/models/widget-config';

/**
 * Port of `visitor_variables_test.dart`.
 *
 * BOTH syntaxes are accepted, matching the server: this codebase shipped
 * `%number%` in queue text and `{{name}}` in canned responses, and a tenant
 * should not have to remember which surface takes which.
 */
describe('substituteVisitorVariables', () => {
  it('fills %name% and {{name}} alike', () => {
    expect(substituteVisitorVariables('Hi %name%!', { name: 'Ada Lovelace' })).toBe(
      'Hi Ada Lovelace!',
    );
    expect(substituteVisitorVariables('Hi {{name}}!', { name: 'Ada Lovelace' })).toBe(
      'Hi Ada Lovelace!',
    );
    expect(substituteVisitorVariables('Hi {{ name }}!', { name: 'Ada' })).toBe('Hi Ada!');
  });

  it('fills first_name with the first whitespace-separated word', () => {
    expect(substituteVisitorVariables('Hi %first_name%!', { name: 'Ada Lovelace' })).toBe('Hi Ada!');
    expect(substituteVisitorVariables('Hi {{first_name}}!', { name: 'Ada  Lovelace' })).toBe(
      'Hi Ada!',
    );
  });

  it('is case-insensitive', () => {
    expect(substituteVisitorVariables('Hi %NAME%', { name: 'Ada' })).toBe('Hi Ada');
    expect(substituteVisitorVariables('Hi {{First_Name}}', { name: 'Ada Lovelace' })).toBe('Hi Ada');
  });

  it('replaces every occurrence', () => {
    expect(substituteVisitorVariables('%name% %name% {{name}}', { name: 'Ada' })).toBe(
      'Ada Ada Ada',
    );
  });

  it('falls back to defaultName, then to nothing — never to a literal token', () => {
    expect(substituteVisitorVariables('Hi %name%!', { defaultName: 'there' })).toBe('Hi there!');
    expect(substituteVisitorVariables('Hi %name%!', { name: '   ', defaultName: 'there' })).toBe(
      'Hi there!',
    );
    // The important one: an unidentified visitor with no configured default
    // must never be shown `%name%` on screen.
    expect(substituteVisitorVariables('Hi %name%!', {})).toBe('Hi !');
    expect(substituteVisitorVariables('Hi %first_name%!', {})).toBe('Hi !');
  });

  it('leaves unrelated tokens alone', () => {
    expect(substituteVisitorVariables('You are %number% in the queue', { name: 'Ada' })).toBe(
      'You are %number% in the queue',
    );
    expect(substituteVisitorVariables('{{company}}', { name: 'Ada' })).toBe('{{company}}');
  });

  it('trims the resolved name', () => {
    expect(substituteVisitorVariables('%name%', { name: '  Ada  ' })).toBe('Ada');
  });
});
