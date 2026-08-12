// Terminal input. The TTY check here is the security boundary, not a nicety:
// an agent shell has no TTY, so `login` cannot be run by a coding agent, so a
// password cannot end up in a transcript. Enforced by the mechanism rather than
// by asking the model nicely.

import { createInterface } from 'node:readline';

export function hasTty() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); }));
}

// Control codes, by number. Written this way on purpose: the literal characters
// are invisible in an editor and a stray escape survives review far too easily.
const LF = 10;
const CR = 13;
const CTRL_C = 3;
const CTRL_D = 4;
const BACKSPACE = 8;
const DELETE = 127;
const FIRST_PRINTABLE = 32;

// Raw mode, echo suppressed. Never logged, never stored, never accepted as a flag
// or an env var — a password on a command line is in the process table and in the
// shell history for every other process on the box to read.
export function askSecret(question) {
  return new Promise((resolve, reject) => {
    const { stdin, stdout } = process;
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';

    const finish = (err) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (err) reject(err); else resolve(value);
    };

    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.codePointAt(0);
        if (code === CR || code === LF || code === CTRL_D) return finish();
        if (code === CTRL_C) return finish(new Error('cancelled'));
        if (code === BACKSPACE || code === DELETE) { value = value.slice(0, -1); continue; }
        if (code >= FIRST_PRINTABLE) value += ch;
      }
    };
    stdin.on('data', onData);
  });
}
