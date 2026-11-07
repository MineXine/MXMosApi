import UAParser from 'ua-parser-js';
import type { DeviceInfo } from '../../../shared/types.js';

/** 解析 UA，得到浏览器 / 系统 / 设备类型信息 */
export function parseDevice(ua: string | undefined | null): DeviceInfo {
  const raw = ua ?? '';
  const parser = new UAParser(raw);
  const r = parser.getResult();

  const browser = r.browser.name ?? 'Unknown';
  const os = r.os.name ?? 'Unknown';
  let deviceType = 'desktop';
  if (r.device.type === 'mobile') deviceType = 'mobile';
  else if (r.device.type === 'tablet') deviceType = 'tablet';
  else if (r.device.type) deviceType = r.device.type;

  return {
    browser,
    browserVersion: r.browser.version ?? '',
    os,
    osVersion: r.os.version ?? '',
    deviceType,
    deviceVendor: r.device.vendor ?? '',
    ua: raw.slice(0, 400),
  };
}
