/**
 * Test script to verify todo list mapping
 */

import { eventMapper } from './src/bridge/event-mapper.js';

// Test event 1: Initial todo list with all pending items
const event1 = {
    type: 'tool_use' as const,
    timestamp: '2026-03-17T18:34:32.512Z',
    tool_name: 'update_todo_list',
    tool_id: 'tool-2',
    parameters: {
        todos: '\n[ ] Create greeter.h header file with greeting function declaration\n[ ] Create greeter.c implementation file with greeting function\n[ ] Modify hello.c to use the greeter function\n[ ] Create Makefile for building the project\n'
    }
};

// Test event 2: Updated todo list with all completed items
const event2 = {
    type: 'tool_use' as const,
    timestamp: '2026-03-17T18:35:42.629Z',
    tool_name: 'update_todo_list',
    tool_id: 'tool-7',
    parameters: {
        todos: '\n[x] Create greeter.h header file with greeting function declaration\n[x] Create greeter.c implementation file with greeting function\n[x] Modify hello.c to use the greeter function\n[x] Create Makefile for building the project\n'
    }
};

console.log('Testing todo list mapping...\n');

console.log('Test 1: Initial todo list (all pending)');
console.log('Input:', JSON.stringify(event1, null, 2));
const result1 = eventMapper.mapEvent(event1, 'test-session-1');
console.log('Output:', JSON.stringify(result1, null, 2));
console.log('\n---\n');

console.log('Test 2: Updated todo list (all completed)');
console.log('Input:', JSON.stringify(event2, null, 2));
const result2 = eventMapper.mapEvent(event2, 'test-session-2');
console.log('Output:', JSON.stringify(result2, null, 2));
console.log('\n---\n');

// Verify the structure
if (result1 && result1.sessionUpdate === 'plan' && 'entries' in result1) {
    console.log('✓ Test 1 passed: Correctly mapped to plan with', result1.entries.length, 'entries');
    console.log('  All entries have status "pending":', result1.entries.every(e => e.status === 'pending'));
} else {
    console.log('✗ Test 1 failed: Did not map to plan correctly');
}

if (result2 && result2.sessionUpdate === 'plan' && 'entries' in result2) {
    console.log('✓ Test 2 passed: Correctly mapped to plan with', result2.entries.length, 'entries');
    console.log('  All entries have status "completed":', result2.entries.every(e => e.status === 'completed'));
} else {
    console.log('✗ Test 2 failed: Did not map to plan correctly');
}

// Made with Bob
