const {
  NSAutoreleasePool,
} = ObjC.classes;

const NO = 0;

const sbs = importSpringBoardServices();
const pidPtr = Memory.alloc(4);

rpc.exports = {
  enumerateApplications() {
    return performWithAutoreleasePool(() => {
      const identifiers = sbs.copyApplicationDisplayIdentifiers(NO, NO);
      return mapNSArray(identifiers, identifier => {
        const name = sbs.copyLocalizedApplicationNameForDisplayIdentifier(identifier);

        let pid;
        if (sbs.processIDForDisplayIdentifier(identifier, pidPtr))
          pid = pidPtr.readU32();
        else
          pid = 0;

        const parameters = {};

        return [identifier.toString(), name.toString(), pid, parameters];
      });
    });
  }
};

function importSpringBoardServices() {
  return [
    ['copyApplicationDisplayIdentifiers', 'pointer', ['bool', 'bool']],
    ['copyLocalizedApplicationNameForDisplayIdentifier', 'pointer', ['pointer']],
    ['processIDForDisplayIdentifier', 'bool', ['pointer', 'pointer']],
  ].reduce((api, [name, retType, argTypes]) => {
    const cname = 'SBS' + name[0].toUpperCase() + name.substring(1);
    const func = new NativeFunction(
        Module.getExportByName('/System/Library/PrivateFrameworks/SpringBoardServices.framework/SpringBoardServices', cname),
        retType,
        argTypes);

    let wrapper;
    if (name.startsWith('copy'))
      wrapper = (...args) => objcHandleToAutoreleasedWrapper(func(...args));
    else
      wrapper = func;

    api[name] = wrapper;

    return api;
  }, {});
}

function objcHandleToAutoreleasedWrapper(handle) {
  if (handle.isNull())
    return null;
  return new ObjC.Object(handle).autorelease();
}

function performWithAutoreleasePool(fn) {
  const pool = NSAutoreleasePool.alloc().init();
  try {
    return fn();
  } finally {
    pool.release();
  }
}

function mapNSArray(arr, fn) {
  const result = [];
  const count = arr.count().valueOf();
  for (let i = 0; i !== count; i++)
    result.push(fn(arr.objectAtIndex_(i)));
  return result;
}
