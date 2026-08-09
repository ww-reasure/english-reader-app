const RESET_STATE_HASHES_BY_PACKAGE = Object.freeze({
  'local.kaoyan.en1': Object.freeze([
    'sha256:752e40ea4ed8c853da2aeea135e92f60e4b9c9b5f76707b5612ee93fd3d12a44'
  ])
});

export function getExamPackInstallOptions(pack) {
  return {
    resetStateForContentHashes: RESET_STATE_HASHES_BY_PACKAGE[pack?.manifest?.packageId] || []
  };
}
