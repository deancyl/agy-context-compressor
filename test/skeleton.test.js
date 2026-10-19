const test = require('node:test');
const assert = require('node:assert');
const { extractCodeSkeleton, extractPythonSkeleton, extractJavaScriptSkeleton, extractGoSkeleton } = require('../src/core/skeleton');

test('extractPythonSkeleton: extracts classes, methods, docstrings, multiline signatures and omits bodies', () => {
  const py = `
import os
from typing import List, Optional

class DataProcessor:
    """Class docstring explaining processor."""
    def __init__(self, data: List[str]):
        self.data = data
        self.count = len(data)
        for item in data:
            print(item)

    async def run_pipeline(
        self,
        batch_size: int = 32,
        strict: Optional[bool] = True
    ) -> bool:
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
  assert.ok(skeleton.includes('batch_size: int = 32'));
  assert.ok(skeleton.includes('def standalone_helper'));
  assert.ok(!skeleton.includes('for item in data:'));
  assert.ok(!skeleton.includes('x = 10'));
});

test('extractJavaScriptSkeleton: extracts functions, classes, types with nested braces and omits bodies', () => {
  const js = `
import path from 'path';

export interface UserConfig {
  id: string;
  meta: { role: string; permissions: string[] };
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
  assert.ok(skeleton.includes('meta: { role: string; permissions: string[] };'));
  assert.ok(skeleton.includes('name: string;'));
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

test('extractJavaScriptSkeleton: handles arrow functions, function expressions, and multiline signatures with line spans', () => {
  const code = `
export const calculateScore = (user, scores) => {
  return scores.reduce((a, b) => a + b, 0);
};

const formatOutput = function(title, value) {
  return title + ': ' + value;
};

export async function complexOperation(
  id: string,
  options: { timeout: number; retries: number }
): Promise<boolean> {
  const work = await doWork(id);
  return work.success;
}
`;

  const skeleton = extractJavaScriptSkeleton(code);
  assert.ok(skeleton.includes('export const calculateScore = (user, scores) =>'));
  assert.ok(skeleton.includes('const formatOutput = function(title, value)'));
  assert.ok(skeleton.includes('export async function complexOperation('));
  assert.ok(skeleton.includes('[Line 2-4]'));
  assert.ok(!skeleton.includes('return scores.reduce'));
  assert.ok(!skeleton.includes('const work = await doWork'));
});

test('extractCodeSkeleton: extracts Rust, Java, and C++ signatures', () => {
  const rust = `
use std::collections::HashMap;

pub struct Config {
    pub port: u16,
}

impl Config {
    pub fn new() -> Self {
        Self { port: 8080 }
    }
}

pub async fn run_server(config: Config) {
    println!("Server running");
}
`;

  const rsSkeleton = extractCodeSkeleton(rust, 'src/main.rs');
  assert.ok(rsSkeleton.includes('pub struct Config'));
  assert.ok(rsSkeleton.includes('impl Config'));
  assert.ok(rsSkeleton.includes('pub fn new() -> Self'));
  assert.ok(rsSkeleton.includes('pub async fn run_server(config: Config)'));
  assert.ok(!rsSkeleton.includes('println!("Server running")'));

  const java = `
package com.example;

public class Application {
    private int port = 8080;

    public static void main(String[] args) {
        System.out.println("Hello World");
    }

    public void start() throws Exception {
        doStart();
    }
}
`;

  const javaSkeleton = extractCodeSkeleton(java, 'Application.java');
  assert.ok(javaSkeleton.includes('public class Application'));
  assert.ok(javaSkeleton.includes('public static void main(String[] args)'));
  assert.ok(javaSkeleton.includes('public void start() throws Exception'));
  assert.ok(!javaSkeleton.includes('System.out.println'));

  const cpp = `
#include <iostream>

class Engine {
public:
    void run() {
        std::cout << "running" << std::endl;
    }
};

int main(int argc, char** argv) {
    Engine e;
    e.run();
    return 0;
}
`;
  const cppSkeleton = extractCodeSkeleton(cpp, 'main.cpp');
  assert.ok(cppSkeleton.includes('#include <iostream>'));
  assert.ok(cppSkeleton.includes('class Engine'));
  assert.ok(cppSkeleton.includes('int main(int argc, char** argv)'));
  assert.ok(!cppSkeleton.includes('std::cout'));
});
