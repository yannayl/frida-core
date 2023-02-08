const LIBXPC = '/usr/lib/system/libxpc.dylib';
const bootstrapPort = Module.getExportByName(LIBXPC, 'bootstrap_port').readU32();
const _bootstrapLookUp = new NativeFunction(Module.getExportByName(LIBXPC, 'bootstrap_look_up'),
    'uint',
    ['uint', 'pointer', 'pointer'],
    { exceptions: 'propagate' });

rpc.exports = {
  bootstrapLookUp(serviceName) {
    const portPtr = Memory.alloc(4);
    const kr = _bootstrapLookUp(bootstrapPort, Memory.allocUtf8String(serviceName), portPtr);
    if (kr !== 0)
      throw new Error('bootstrap_look_up() failed');
    return portPtr.readU32();
  },
};
