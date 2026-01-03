#!/usr/bin/env node

/**
 * Permission System Test Suite
 * Tests the centralized permission handling against known Jellyseerr values
 */

import { Permission, hasPermission, getPermissionType, canApproveRequests, canAutoApprove, analyzePermissions, debugPermissions } from '../lib/permissions.js';

// Test cases based on common Jellyseerr permission scenarios
const testCases = [
  {
    name: 'No permissions (new user)',
    permissions: 0,
    expected: {
      type: 'user',
      canApprove: false,
      canAutoApprove: false
    }
  },
  {
    name: 'Admin user',
    permissions: Permission.ADMIN,
    expected: {
      type: 'admin', 
      canApprove: true,
      canAutoApprove: true
    }
  },
  {
    name: 'Request manager',
    permissions: Permission.MANAGE_REQUESTS,
    expected: {
      type: 'manager',
      canApprove: true,
      canAutoApprove: false
    }
  },
  {
    name: 'Settings manager',
    permissions: Permission.MANAGE_SETTINGS,
    expected: {
      type: 'manager',
      canApprove: false,
      canAutoApprove: false
    }
  },
  {
    name: 'User manager',
    permissions: Permission.MANAGE_USERS,
    expected: {
      type: 'manager',
      canApprove: false,
      canAutoApprove: false
    }
  },
  {
    name: 'Auto-approve user (general)',
    permissions: Permission.AUTO_APPROVE,
    expected: {
      type: 'auto-approve',
      canApprove: false,
      canAutoApprove: true
    }
  },
  {
    name: 'Auto-approve movies only',
    permissions: Permission.AUTO_APPROVE_MOVIE,
    expected: {
      type: 'auto-approve',
      canApprove: false,
      canAutoApprove: true
    }
  },
  {
    name: 'Basic requester',
    permissions: Permission.REQUEST,
    expected: {
      type: 'user',
      canApprove: false,
      canAutoApprove: false
    }
  },
  {
    name: 'Combined: Admin + Request + Auto-approve',
    permissions: Permission.ADMIN | Permission.REQUEST | Permission.AUTO_APPROVE,
    expected: {
      type: 'admin',
      canApprove: true,
      canAutoApprove: true
    }
  },
  {
    name: 'Combined: Manager + Auto-approve movies',
    permissions: Permission.MANAGE_REQUESTS | Permission.AUTO_APPROVE_MOVIE,
    expected: {
      type: 'manager',
      canApprove: true,
      canAutoApprove: true
    }
  },
  {
    name: 'All permissions (super admin)',
    permissions: Object.values(Permission).reduce((acc, val) => acc | val, 0),
    expected: {
      type: 'admin',
      canApprove: true,
      canAutoApprove: true
    }
  }
];

function runTests() {
  console.log('🧪 Running Permission System Tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    console.log(`Testing: ${testCase.name}`);
    console.log(`Permissions value: ${testCase.permissions} (binary: ${testCase.permissions.toString(2)})`);
    
    // Test permission type
    const actualType = getPermissionType(testCase.permissions);
    const typeMatch = actualType === testCase.expected.type;
    
    // Test approval permissions  
    const actualCanApprove = canApproveRequests(testCase.permissions);
    const approveMatch = actualCanApprove === testCase.expected.canApprove;
    
    // Test auto-approve permissions
    const actualCanAutoApprove = canAutoApprove(testCase.permissions);
    const autoApproveMatch = actualCanAutoApprove === testCase.expected.canAutoApprove;
    
    // Test analysis function
    const analysis = analyzePermissions(testCase.permissions);
    const analysisValid = analysis.isValid && analysis.permissionType === testCase.expected.type;
    
    const allMatch = typeMatch && approveMatch && autoApproveMatch && analysisValid;
    
    if (allMatch) {
      console.log('✅ PASSED');
      passed++;
    } else {
      console.log('❌ FAILED');
      console.log(`  Expected type: ${testCase.expected.type}, got: ${actualType} ${typeMatch ? '✓' : '✗'}`);
      console.log(`  Expected canApprove: ${testCase.expected.canApprove}, got: ${actualCanApprove} ${approveMatch ? '✓' : '✗'}`);
      console.log(`  Expected canAutoApprove: ${testCase.expected.canAutoApprove}, got: ${actualCanAutoApprove} ${autoApproveMatch ? '✓' : '✗'}`);
      console.log(`  Analysis valid: ${analysisValid} ${analysisValid ? '✓' : '✗'}`);
      failed++;
    }
    
    console.log(''); // Empty line for readability
  }
  
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! Permission system is working correctly.');
  } else {
    console.log('⚠️ Some tests failed. Please review the permission logic.');
    process.exit(1);
  }
}

// Test individual permission checks
function testPermissionChecks() {
  console.log('\n🔍 Testing individual permission checks...\n');
  
  const testPermissions = Permission.ADMIN | Permission.REQUEST | Permission.AUTO_APPROVE_MOVIE;
  
  console.log(`Test permissions: ${testPermissions} (binary: ${testPermissions.toString(2)})`);
  
  // Test various permission checks
  const checks = [
    ['ADMIN', Permission.ADMIN, true],
    ['REQUEST', Permission.REQUEST, true], 
    ['AUTO_APPROVE_MOVIE', Permission.AUTO_APPROVE_MOVIE, true],
    ['AUTO_APPROVE_TV', Permission.AUTO_APPROVE_TV, false],
    ['MANAGE_REQUESTS', Permission.MANAGE_REQUESTS, false],
    ['Multiple permissions (ADMIN + REQUEST)', [Permission.ADMIN, Permission.REQUEST], true],
    ['Multiple permissions (ADMIN OR MANAGE_REQUESTS)', [Permission.ADMIN, Permission.MANAGE_REQUESTS], true],
    ['Multiple permissions (MANAGE_REQUESTS AND MANAGE_USERS)', [Permission.MANAGE_REQUESTS, Permission.MANAGE_USERS], false]
  ];
  
  for (const [name, permission, expected] of checks) {
    const result = hasPermission(permission, testPermissions, 
      Array.isArray(permission) && name.includes('AND') ? { type: 'and' } : { type: 'or' });
    const match = result === expected;
    
    console.log(`${match ? '✅' : '❌'} ${name}: ${result} (expected ${expected})`);
  }
}

// Test edge cases
function testEdgeCases() {
  console.log('\n🧪 Testing edge cases...\n');
  
  const edgeCases = [
    ['Invalid permissions (string)', 'invalid', 'user', false],
    ['Invalid permissions (null)', null, 'user', false],
    ['Invalid permissions (undefined)', undefined, 'user', false],
    ['Invalid permissions (negative)', -1, 'user', false],
    ['Very large permissions', 999999999, 'admin', true], // Should be treated as admin due to fallback
  ];
  
  for (const [name, permissions, expectedType, expectedValid] of edgeCases) {
    console.log(`Testing: ${name}`);
    
    const actualType = getPermissionType(permissions);
    const analysis = analyzePermissions(permissions);
    
    const typeMatch = actualType === expectedType;
    const validMatch = analysis.isValid === expectedValid;
    
    console.log(`  Type: ${actualType} (expected ${expectedType}) ${typeMatch ? '✓' : '✗'}`);
    console.log(`  Valid: ${analysis.isValid} (expected ${expectedValid}) ${validMatch ? '✓' : '✗'}`);
    
    if (typeMatch && validMatch) {
      console.log('✅ Edge case handled correctly');
    } else {
      console.log('❌ Edge case not handled correctly');
    }
    console.log('');
  }
}

// Run all tests
console.log('🚀 Starting Permission System Test Suite\n');
runTests();
testPermissionChecks();
testEdgeCases();

console.log('\n✨ Test suite completed!');