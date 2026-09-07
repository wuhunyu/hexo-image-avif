'use strict';

const { processImages: defaultProcessImages } = require('./lib/processor');

function register(hexoInstance, deps = {}) {
  const processImages = deps.processImages || defaultProcessImages;

  hexoInstance.extend.filter.register('after_init', async () => {
    if (hexoInstance.env.cmd === 'g' || hexoInstance.env.cmd === 'generate') {
      return processImages(hexoInstance);
    }
  });

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
