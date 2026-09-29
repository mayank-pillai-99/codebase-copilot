import { beforeAll, describe, expect, it } from 'vitest';
import { createCodeParser, type CodeParser, type ParsedFile } from '../src/indexing/parser';

let parser: CodeParser;
beforeAll(async () => {
  parser = await createCodeParser();
});

const ts = (source: string): ParsedFile => parser.parse(source, 'typescript');
const symbolSummary = (file: ParsedFile) =>
  file.symbols.map(
    (s) =>
      `${s.kind} ${s.qualifiedName}${s.exported ? ' [exported]' : ''}${s.isDefault ? ' [default]' : ''}`,
  );

describe('symbols', () => {
  it('extracts functions, classes, methods, interfaces, types and enums', () => {
    const file = ts(`
export async function createPayment(amount: number): Promise<void> {}
function helper() {}
export class PaymentService extends Base {
  private handler = async (event: Event) => {};
  async charge(id: string) {}
  static create() {}
}
export interface Payment { id: string }
type Status = 'ok' | 'failed';
export enum Currency { USD, EUR }
`);
    expect(symbolSummary(file)).toEqual([
      'FUNCTION createPayment [exported]',
      'FUNCTION helper',
      'CLASS PaymentService [exported]',
      'METHOD PaymentService.handler [exported]',
      'METHOD PaymentService.charge [exported]',
      'METHOD PaymentService.create [exported]',
      'INTERFACE Payment [exported]',
      'TYPE Status',
      'ENUM Currency [exported]',
    ]);
    expect(file.hasErrors).toBe(false);
  });

  it('treats function-valued consts as functions and records exported values', () => {
    const file = ts(`
export const getUser = async (id: string): Promise<User> => db.find(id);
const local = function named() {};
export const router = Router();
const notExported = 42;
export const Button = class {};
`);
    expect(symbolSummary(file)).toEqual([
      'FUNCTION getUser [exported]',
      'FUNCTION local',
      'VARIABLE router [exported]',
      'CLASS Button [exported]',
    ]);
    // Like function signatures, the export keyword isn't part of the signature.
    expect(file.symbols[0]?.signature).toBe('const getUser = async (id: string): Promise<User> =>');
  });

  it('records signatures without bodies, line ranges including export, and JSDoc', () => {
    const file = ts(`import x from 'y';

/**
 * Charges a customer.
 * @param amount in cents
 */
export async function charge(
  amount: number,
): Promise<Receipt> {
  return pay(amount);
}
`);
    expect(file.symbols[0]).toMatchObject({
      signature: 'async function charge( amount: number, ): Promise<Receipt>',
      startLine: 7,
      endLine: 11,
      docComment: 'Charges a customer.\n@param amount in cents',
    });
  });

  it('ignores comments that are not JSDoc or not adjacent', () => {
    const file = ts(`/** far away */

function a() {}
// line comment
function b() {}`);
    expect(file.symbols.map((s) => s.docComment)).toEqual([null, null]);
  });

  it('marks default and later exports', () => {
    const file = ts(`
class Store {}
function util() {}
function internal() {}
export { util, internal as publicName };
export default Store;
`);
    expect(symbolSummary(file)).toEqual([
      'CLASS Store [exported] [default]',
      'FUNCTION util [exported]',
      'FUNCTION internal [exported]',
    ]);
  });

  it('names anonymous default exports "default"', () => {
    expect(symbolSummary(ts('export default async function () {}'))).toEqual([
      'FUNCTION default [exported] [default]',
    ]);
    expect(symbolSummary(ts('export default function handler() {}'))).toEqual([
      'FUNCTION handler [exported] [default]',
    ]);
  });

  it('parses TSX components', () => {
    const file = parser.parse(
      `export function Button({ label }: Props) { return <button onClick={() => track(label)}>{label}</button>; }`,
      'tsx',
    );
    expect(symbolSummary(file)).toEqual(['FUNCTION Button [exported]']);
    expect(file.calls.map((c) => c.calleeName)).toEqual(['track']);
    expect(file.hasErrors).toBe(false);
  });

  it('parses plain JavaScript with JSX', () => {
    const file = parser.parse(
      `export default function App() { return <Layout><Page /></Layout>; }`,
      'javascript',
    );
    expect(symbolSummary(file)).toEqual(['FUNCTION App [exported] [default]']);
    expect(file.hasErrors).toBe(false);
  });

  it('flags files with syntax errors but still extracts what it can', () => {
    const file = ts(`export function ok() {}\nfunction broken( {`);
    expect(file.hasErrors).toBe(true);
    expect(file.symbols[0]?.name).toBe('ok');
  });
});

describe('imports', () => {
  it('extracts default, named, aliased, namespace and side-effect imports', () => {
    const file = ts(`
import express, { Router, json as parseJson } from 'express';
import * as db from './db';
import type { User } from '../types';
import './polyfills';
`);
    expect(
      file.imports.map(({ specifier, kind, bindings }) => ({ specifier, kind, bindings })),
    ).toEqual([
      {
        specifier: 'express',
        kind: 'static',
        bindings: [
          { local: 'express', imported: 'default' },
          { local: 'Router', imported: 'Router' },
          { local: 'parseJson', imported: 'json' },
        ],
      },
      { specifier: './db', kind: 'static', bindings: [{ local: 'db', imported: '*' }] },
      { specifier: '../types', kind: 'static', bindings: [{ local: 'User', imported: 'User' }] },
      { specifier: './polyfills', kind: 'static', bindings: [] },
    ]);
  });

  it('extracts re-exports', () => {
    const file = ts(`
export { createUser, deleteUser as removeUser } from './users';
export * from './payments';
export * as auth from './auth';
`);
    expect(file.imports.map((i) => [i.specifier, i.kind, i.reexports])).toEqual([
      [
        './users',
        'reexport',
        [
          { exported: 'createUser', imported: 'createUser' },
          { exported: 'removeUser', imported: 'deleteUser' },
        ],
      ],
      ['./payments', 'reexport', [{ exported: '*', imported: '*' }]],
      ['./auth', 'reexport', [{ exported: 'auth', imported: '*' }]],
    ]);
  });

  it('extracts require() and dynamic import() with static strings only', () => {
    const file = parser.parse(
      `
const express = require('express');
const { readFile, join: joinPath } = require('node:fs');
async function load() { return import('./plugins/' + name); }
const lazy = () => import('./lazy');
require(dynamicName);
`,
      'javascript',
    );
    expect(file.imports.map((i) => [i.specifier, i.kind, i.bindings])).toEqual([
      ['express', 'require', [{ local: 'express', imported: '*' }]],
      [
        'node:fs',
        'require',
        [
          { local: 'readFile', imported: 'readFile' },
          { local: 'joinPath', imported: 'join' },
        ],
      ],
      ['./lazy', 'dynamic', []],
    ]);
  });
});

describe('calls', () => {
  it('attributes calls to the innermost enclosing symbol', () => {
    const file = ts(`
setup();
export class Checkout {
  async submit() {
    const total = this.pricing.total(cart);
    await createPayment(total);
    return new Receipt(total);
  }
}
function outer() {
  const inner = () => log('x');
}
`);
    const summary = file.calls.map((c) => {
      const from =
        c.fromSymbolIndex === null ? '<module>' : file.symbols[c.fromSymbolIndex]!.qualifiedName;
      return `${from} → ${c.isConstructor ? 'new ' : ''}${c.calleeText} (${c.calleeName}, receiver ${c.receiver})`;
    });
    expect(summary).toEqual([
      '<module> → setup (setup, receiver null)',
      'Checkout.submit → this.pricing.total (total, receiver this.pricing)',
      'Checkout.submit → createPayment (createPayment, receiver null)',
      'Checkout.submit → new Receipt (Receipt, receiver null)',
      'outer → log (log, receiver null)',
    ]);
  });

  it('skips require, dynamic import, super and chained calls', () => {
    const file = ts(`
class A extends B { constructor() { super(); } }
const m = require('m');
import('./x');
makeHandler()();
`);
    expect(file.calls.map((c) => c.calleeText)).toEqual(['makeHandler']);
  });
});
