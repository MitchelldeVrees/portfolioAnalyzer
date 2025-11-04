import { createBrowserClient } from "@supabase/ssr"

const memoryStorage = (() => {
  const store = new Map<string, string>()
  return {
    async getItem(key: string) {
      return store.get(key) ?? null
    },
    async setItem(key: string, value: string) {
      store.set(key, value)
    },
    async removeItem(key: string) {
      store.delete(key)
    },
  }
})()

export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false,
      storage: memoryStorage,
    },
  })
}
