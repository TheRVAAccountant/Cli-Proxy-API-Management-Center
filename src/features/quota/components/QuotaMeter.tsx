/**
 * 额度水位条（原 QuotaProgressBar 的类型化后继）。
 *
 * dataviz 语法：细轨道退居背景，填充按剩余量三档着色（≥70 绿 / ≥30 琥珀 / <30 红），
 * percent === null 渲染空轨道 —— 未知不着色（Medium 类在 width 0 下不可见，行为与旧版一致）。
 * `index` 写入 `--meter-index`，供全页外衣做逐行入场级差；紧凑外衣不消费该变量。
 */

import type { CSSProperties } from 'react';
import {
  QUOTA_LEVEL_HIGH_THRESHOLD,
  QUOTA_LEVEL_MEDIUM_THRESHOLD,
  clampQuotaPercent,
  quotaLevel,
} from '../level';
import type { QuotaClassMap } from '../types';

export const QUOTA_PROGRESS_HIGH_THRESHOLD = QUOTA_LEVEL_HIGH_THRESHOLD;
export const QUOTA_PROGRESS_MEDIUM_THRESHOLD = QUOTA_LEVEL_MEDIUM_THRESHOLD;

const LEVEL_FILL_KEY = {
  high: 'quotaBarFillHigh',
  medium: 'quotaBarFillMedium',
  low: 'quotaBarFillLow',
} as const;

export interface QuotaMeterProps {
  percent: number | null;
  classes: QuotaClassMap;
  index?: number;
}

export function QuotaMeter({ percent, classes, index }: QuotaMeterProps) {
  const normalized = percent === null ? null : clampQuotaPercent(percent);
  // Unknown keeps the medium class at width 0 (invisible), matching the previous meter.
  const fillClass =
    normalized === null
      ? classes.quotaBarFillMedium
      : classes[LEVEL_FILL_KEY[quotaLevel(normalized)]];
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;
  const style: CSSProperties & { '--meter-index'?: number } = { width: `${widthPercent}%` };
  if (index !== undefined) {
    style['--meter-index'] = index;
  }

  return (
    <div className={classes.quotaBar}>
      <div className={`${classes.quotaBarFill} ${fillClass}`} style={style} />
    </div>
  );
}
