'use strict';
// emerge/lang/errors.js — the two error kinds of the language. Every one names where it happened.
// component_id: emerge.lang.errors · spec: emerge/lang/emerge-lang.spec (rules: every diagnostic carries file:line:col)

/** A compile-time error: lexing, parsing or checking. Always has a location. */
class EmergeSyntaxError extends Error {
  constructor(message, file, line, col) {
    super(`${file}:${line}:${col}: ${message}`);
    this.name = 'EmergeSyntaxError';
    this.bare = message;
    this.file = file;
    this.line = line;
    this.col = col;
  }
}

/** A run-time error. The runtime fills in file and line from the statement being executed. */
class EmergeError extends Error {
  constructor(message, file, line) {
    super(`${file}:${line}: ${message}`);
    this.name = 'EmergeError';
    this.bare = message;
    this.file = file;
    this.line = line;
  }
}

module.exports = { EmergeSyntaxError, EmergeError };
