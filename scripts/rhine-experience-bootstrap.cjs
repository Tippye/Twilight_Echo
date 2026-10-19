const { app } = require('electron')
const { resolve, join } = require('node:path')
if (!process.env.RHINE_TEST_PROFILE) throw new Error('Isolated RHINE_TEST_PROFILE is required')
app.setPath('userData', resolve(process.env.RHINE_TEST_PROFILE))
if (process.env.RHINE_TEST_PACKAGE) {
  const resources = join(resolve(process.env.RHINE_TEST_PACKAGE), 'resources')
  const archive = join(resources, 'app.asar')
  app.setAppPath(archive)
  Object.defineProperty(process, 'resourcesPath', { value: resources })
  require(join(archive, 'out/main/index.js'))
} else {
  require('../out/main/index.js')
}
