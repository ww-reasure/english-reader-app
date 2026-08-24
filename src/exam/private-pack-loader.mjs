import { installExamPack } from './pack-installer.mjs';
import { getExamPackInstallOptions } from './pack-install-policy.mjs';

function errorReason(error) {
  return String(error?.message || '题包安装失败').trim().slice(0, 160);
}

export async function installPrivateExamPacks({
  fetchImpl = fetch,
  installPack = installExamPack,
  openDb
} = {}) {
  let index;
  try {
    const response = await fetchImpl('/exam-packs/private/index.json');
    if (!response?.ok) throw new Error('题包索引无法读取');
    index = await response.json();
  } catch (error) {
    return {
      installed: [],
      failures: [{ packageId: 'index', reason: errorReason(error) }]
    };
  }
  const installed = [];
  const failures = [];
  for (const entry of index.packs || []) {
    try {
      const packResponse = await fetchImpl(entry.path);
      if (!packResponse?.ok) throw new Error('题包文件无法读取');
      const pack = await packResponse.json();
      installed.push(await installPack(openDb, pack, getExamPackInstallOptions(pack)));
    } catch (error) {
      failures.push({ packageId: String(entry.packageId || 'unknown'), reason: errorReason(error) });
    }
  }
  return { installed, failures };
}
