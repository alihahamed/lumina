// Metro resolves `require('…/model.pte')` to an asset id (see metro.config.js).
declare module '*.pte' {
  const asset: number
  export default asset
}
