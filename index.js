'use strict';

const { processImages: defaultProcessImages } = require('./lib/processor');

function register(hexoInstance, deps = {}) {
  const processImages = deps.processImages || defaultProcessImages;
  const priority = hexoInstance.config?.image_avif?.priority ?? 0;

  hexoInstance.extend.filter.register('after_init', async () => {
    if (hexoInstance.env.cmd === 'g' || hexoInstance.env.cmd === 'generate') {
      return processImages(hexoInstance);
    }
  }, priority);

  hexoInstance.extend.console.register(
    'images',
    'Localize remote post images and convert them to AVIF.',
    async () => processImages(hexoInstance),
  );
}

if (typeof hexo !== 'undefined') {
  register(hexo);
}

module.exports = {
  register,
};
