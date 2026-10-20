import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySshFailure } from '../server/integrations';

test('SSH diagnostics distinguish launch, authentication, host verification and network failures', () => {
  const cases: Array<[any, string, RegExp]> = [
    [{code:'EPERM'}, '', /operating system denied/],
    [{code:'EACCES'}, '', /operating system denied/],
    [{code:255}, 'Load key "/private/example": Permission denied', /operating system denied/],
    [{code:255}, 'identity file /private/example not accessible: Operation not permitted', /operating system denied/],
    [{code:255}, 'user@server: Permission denied (publickey).', /authentication was rejected/],
    [{code:255}, 'Host key verification failed.', /host verification failed/],
    [{code:255}, '@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!', /host verification failed/],
    [{code:255}, 'ssh: Could not resolve hostname example: nodename nor servname provided', /could not resolve/],
    [{code:'ENOTFOUND'}, '', /could not resolve/],
    [{code:255}, 'ssh: connect to host example port 22: Operation timed out', /connection timed out/],
    [{code:'ETIMEDOUT'}, '', /connection timed out/],
    [{code:255}, 'ssh: connect to host example port 22: Connection refused', /connection was refused/],
    [{code:255}, 'ssh: connect to host example port 22: No route to host', /could not reach/],
    [{code:'ENOENT'}, '', /process could not start/],
    [{code:'ENOTDIR'}, '', /process could not start/],
  ];
  for (const [error, stderr, expected] of cases) assert.match(classifySshFailure(error, stderr), expected);
});

test('bounded-reader output and maxBuffer failures are explicit without raising their limits', () => {
  assert.match(classifySshFailure({code:1}, 'Status response exceeds size limit'), /configured output limit/);
  assert.match(classifySshFailure({code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'}, 'stdout maxBuffer length exceeded'), /configured output limit/);
});

test('termination metadata is allowlisted and does not assert that every signal is a timeout', () => {
  const terminated=classifySshFailure({code:null,signal:'SIGTERM',killed:true});
  assert.match(terminated,/was terminated/);assert.match(terminated,/timed out or the process was interrupted/);assert.match(terminated,/signal=SIGTERM; killed=true/);
  assert.match(classifySshFailure({code:255,signal:null,killed:false},''),/code=255/);
  assert.match(classifySshFailure(null),/without a recognized diagnostic/);
});

test('raw SSH stderr, error text, paths, hosts, tokens and unrecognized metadata never leave the classifier', () => {
  const secret='FAKE_TOKEN_SHOULD_NEVER_APPEAR';
  const details=`/Users/private-person/Documents/${secret}.key private-person@192.0.2.99 Authorization: Bearer ${secret}`;
  const samples=['Permission denied (publickey).','Operation not permitted','Host key verification failed.','Could not resolve hostname','Connection timed out','Status response exceeds size limit','unrecognized diagnostic'];
  for(const sample of samples){
    const error:any={code:secret,signal:secret,killed:true,message:`${secret} ${details}`,path:details,spawnargs:[details]};
    const result=classifySshFailure(error,`${sample}\n${details}`);
    for(const forbidden of [secret,'private-person','192.0.2.99','Authorization','/Users/'])assert.ok(!result.includes(forbidden));
    assert.match(result,/code=unreported/);
  }
  assert.match(classifySshFailure({code:{secret},signal:{secret}}, {secret}),/without a recognized diagnostic/);
});
