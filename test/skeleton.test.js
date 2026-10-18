const test = require('node:test');
const assert = require('node:assert');
const { extractCodeSkeleton, extractPythonSkeleton, extractJavaScriptSkeleton, extractGoSkeleton } = require('../src/core/skeleton');

test('extractPythonSkeleton: extracts classes, methods, docstrings and omits bodies', () => {
  const py = `
import os
from typing import List

class DataProcessor:
    """Class docstring explaining processor."""
    def __init__(self, data: List[str]):
        self.data = data
        self.count = len(data)
        for item in data:
            print(item)

    async def run_pipeline(self) -> bool:
        # lots of complex code here
        x = 10
        y = 20
        return True

def standalone_helper(x: int) -> int:
    return x * 42
`;

  const skeleton = extractPythonSkeleton(py);
  assert.ok(skeleton.includes('import os'));
  assert.ok(skeleton.includes('class DataProcessor:'));
  assert.ok(skeleton.includes('def __init__'));
  assert.ok(skeleton.includes('async def run_pipeline'));
  assert.ok(skeleton.includes('def standalone_helper'));
  assert.ok(!skeleton.includes('for item in data:'));
  assert.ok(!skeleton.includes('x = 10'));
});

test('extractJavaScriptSkeleton: extracts functions, classes, types and omits bodies', () => {
  const js = `
import path from 'path';

export interface UserConfig {
  id: string;
  name: string;
}

export class ServiceClient {
  constructor(options: any) {
    this.options = options;
    this.connect();
    console.log('connected');
  }

  fetchData(query: string): Promise<any> {
    const url = '/api/data';
    return fetch(url);
  }
}

export async function processTask(taskId: string) {
  const res = await doSomething(taskId);
  return res;
}
`;

  const skeleton = extractJavaScriptSkeleton(js);
  assert.ok(skeleton.includes('export interface UserConfig'));
  assert.ok(skeleton.includes('export class ServiceClient'));
  assert.ok(skeleton.includes('fetchData(query: string)'));
  assert.ok(skeleton.includes('export async function processTask'));
  assert.ok(!skeleton.includes('console.log(\'connected\')'));
  assert.ok(!skeleton.includes('const url = \'/api/data\''));
});

test('extractGoSkeleton: extracts package, struct and func signatures', () => {
  const go = `
package main

import "fmt"

type Server struct {
    Host string
    Port int
}

func (s *Server) Start() error {
    fmt.Println("Starting...")
    return nil
}
`;

  const skeleton = extractGoSkeleton(go);
  assert.ok(skeleton.includes('package main'));
  assert.ok(skeleton.includes('type Server struct'));
  assert.ok(skeleton.includes('func (s *Server) Start() error { ... }'));
  assert.ok(!skeleton.includes('fmt.Println("Starting...")'));
});
