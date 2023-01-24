const {
  LSApplicationProxy,
  NSAutoreleasePool,
  NSNumber,
} = ObjC.classes;

const NO = 0;

const sbs = importSpringBoardServices();
const pidPtr = Memory.alloc(4);

rpc.exports = {
  enumerateApplications(identifiers, scope) {
    return performWithAutoreleasePool(() => {
      const identifiers = sbs.copyApplicationDisplayIdentifiers(NO, NO);
      const result = [];
      for (const identifier of parseNSArray(identifiers)) {
        try {
          const name = sbs.copyLocalizedApplicationNameForDisplayIdentifier(identifier);

          let pid;
          if (sbs.processIDForDisplayIdentifier(identifier, pidPtr))
            pid = pidPtr.readU32();
          else
            pid = 0;

          const parameters = (scope !== 'minimal') ? fetchAppParameters(identifier, pid, scope) : null;

          result.push([identifier.toString(), name.toString(), pid, parameters]);
        } catch (e) {
          console.log(`Skipping ${identifier.toString()}: ${e.stack}`);
        }
      }
      return result;
    });
  }
};

function fetchAppParameters(identifier, pid, scope) {
  const parameters = {
    ...fetchAppMetadata(identifier),
  };

  if (scope === 'full') {
    const icon = sbs.copyIconImagePNGDataForDisplayIdentifier(identifier);
    if (icon !== null)
      parameters.$icon = icon.base64EncodedStringWithOptions_(0).toString();
  }

  return parameters;
}

function fetchAppMetadata(identifier, parameters) {
  const meta = {};

  const app = LSApplicationProxy.applicationProxyForIdentifier_(identifier);

  const version = app.shortVersionString();
  if (version !== null)
    meta.version = version.toString();

  const build = app.bundleVersion();
  if (build !== null)
    meta.build = build.toString();

  meta.path = app.bundleURL().path().toString();

  const dataPath = app.dataContainerURL();
  const containerUrls = app.groupContainerURLs();
  if (dataPath !== null || containerUrls?.count() > 0) {
    const containers = {};

    if (dataPath !== null)
      containers.data = dataPath.path().toString();

    if (containerUrls !== null) {
      for (const [key, value] of Object.entries(parseNSDictionary(containerUrls)))
        containers[key] = value.path().toString();
    }

    meta.containers = containers;
  }

  const getTaskAllow = app.entitlementValueForKey_ofClass_('get-task-allow', NSNumber);
  if (getTaskAllow?.boolValue())
    meta.debuggable = true;

  return meta;
}

function importSpringBoardServices() {
  return [
    ['copyApplicationDisplayIdentifiers', 'pointer', ['bool', 'bool']],
    ['copyLocalizedApplicationNameForDisplayIdentifier', 'pointer', ['pointer']],
    ['processIDForDisplayIdentifier', 'bool', ['pointer', 'pointer']],
    ['copyInfoForApplicationWithProcessID', 'pointer', ['uint']],
    ['copyIconImagePNGDataForDisplayIdentifier', 'pointer', ['pointer']],
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

function parseNSArray(arr) {
  const result = [];
  const count = arr.count().valueOf();
  for (let i = 0; i !== count; i++)
    result.push(arr.objectAtIndex_(i));
  return result;
}

function parseNSDictionary(dict) {
  const result = {};
  for (const key of parseNSArray(dict.allKeys()))
    result[key.toString()] = dict.valueForKey_(key);
  return result;
}
