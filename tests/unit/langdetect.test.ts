import { ModelOperations } from '@vscode/vscode-languagedetection';
import { describe, expect, it } from 'vitest';
import { createDetector, pickLanguage } from '../../src/modules/langdetect/detector';
import { detectByHeuristic } from '../../src/modules/langdetect/heuristics';

// Uses the package's Node loaders (reads the bundled model from disk)
const detector = createDetector(new ModelOperations());

const FIXTURES: Record<string, string> = {
  TypeScript:
    'interface User { id: number; name: string }\nexport function greet(u: User): string {\n  return `hi ${u.name}`;\n}\n',
  Python:
    'import os\n\ndef main(argv):\n    for f in os.listdir("."):\n        print(f)\n\nif __name__ == "__main__":\n    main([])\n',
  Go: 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfor i := 0; i < 3; i++ {\n\t\tfmt.Println(i)\n\t}\n}\n',
  SQL: "SELECT u.id, count(*) AS n\nFROM users u\nJOIN orders o ON o.user_id = u.id\nWHERE o.created_at > now() - interval '7 days'\nGROUP BY u.id\nORDER BY n DESC;\n",
  Rust: 'fn main() {\n    let v: Vec<i32> = (1..10).collect();\n    for x in &v {\n        println!("{}", x);\n    }\n}\n',
};

describe('language detection', () => {
  it.each(Object.entries(FIXTURES))('detects %s', async (name, code) => {
    expect((await detector.detect(code))?.language.name).toBe(name);
  });

  it('declines prose and short snippets', async () => {
    const prose =
      'Hi team, just a reminder that the retro is moved to Thursday afternoon. Please add your notes to the board before then so we can get through everything. Thanks!';
    expect(await detector.detect(prose)).toBeNull();
    expect(await detector.detect('x = 1')).toBeNull();
  });

  it('requires a clear winner', () => {
    expect(
      pickLanguage([
        { languageId: 'ts', confidence: 0.2 },
        { languageId: 'js', confidence: 0.15 },
      ]),
    ).toBeNull();
    expect(
      pickLanguage([
        { languageId: 'ts', confidence: 0.2 },
        { languageId: 'js', confidence: 0.05 },
      ]),
    ).toMatchObject({ language: { monaco: 'typescript' } });
  });

  it('uses shebangs and prologs before the model', () => {
    expect(detectByHeuristic('#!/usr/bin/env python3\nprint(1)')?.monaco).toBe('python');
    expect(detectByHeuristic('#!/bin/bash\nls')?.monaco).toBe('shell');
    expect(detectByHeuristic('<?php echo 1;')?.monaco).toBe('php');
    expect(detectByHeuristic('hello')).toBeNull();
  });
});
