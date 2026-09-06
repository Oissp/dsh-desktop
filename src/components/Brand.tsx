import WhaleLogo from './WhaleLogo'

/**
 * 品牌区：彩色渐变动态鲸鱼 logo + "dsh desktop" 字标。
 */
export default function Brand() {
  return (
    <div className="brand" title="dsh desktop">
      <WhaleLogo className="brand-logo" />
      <span className="brand-wordmark">dsh desktop</span>
    </div>
  )
}
