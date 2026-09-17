// RHDH overlay: extends the upstream @backstage/cli-module-new 0.1.6
// setupTests.ts to expose the Web API globals that MSW v2 and
// @backstage/frontend-test-utils require under Jest 29 + jest-environment-jsdom.
//
// The stock jsdom environment does not expose TextEncoder, BroadcastChannel,
// ReadableStream, and several other Web APIs that MSW v2's setupServer() and
// Backstage's test-utils depend on at import time. Jest 30+ uses
// FixedJSDOMEnvironment from @backstage/cli-module-test-jest which injects
// these globals automatically; for Jest 29 the equivalent is done here.
//
// See: packages/cli-module-test-jest/config/jest-environment-jsdom/index.js
// in the upstream Backstage repo for the canonical list of globals injected
// by FixedJSDOMEnvironment.
//
// When the RHDH release targeting @backstage/cli-module-new 0.1.7+
// (Backstage 1.55.0) is supported, verify whether this overlay is still
// needed and remove it if the upstream template has caught up or if the
// project has migrated to Jest 30+.
import { BroadcastChannel } from 'node:worker_threads';
import { TextDecoder, TextEncoder } from 'node:util';
import {
  ReadableStream,
  TransformStream,
  WritableStream,
} from 'node:stream/web';
import '@testing-library/jest-dom';

Object.assign(global, {
  TextDecoder,
  TextEncoder,
  BroadcastChannel,
  TransformStream,
  WritableStream,
  ReadableStream,
});
