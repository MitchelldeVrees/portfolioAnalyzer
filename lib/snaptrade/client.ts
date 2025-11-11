import { Snaptrade } from "snaptrade-typescript-sdk"

let snaptradeClient: Snaptrade | null = null

export function getSnaptradeClient() {
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY
  const clientId = process.env.SNAPTRADE_CLIENT_ID

  if (!consumerKey || !clientId) {
    throw new Error("SnapTrade integration is not configured")
  }

  if (!snaptradeClient) {
    snaptradeClient = new Snaptrade({
      consumerKey,
      clientId,
    })
  }

  return snaptradeClient
}

export function assertSnaptradeConfigured() {
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY
  const clientId = process.env.SNAPTRADE_CLIENT_ID
  if (!consumerKey || !clientId) {
    return false
  }
  return true
}
