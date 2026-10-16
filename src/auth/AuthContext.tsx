import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { User } from 'firebase/auth'
import { mapAuthErrorToItalian } from './authErrors'
import { loadUserProfile } from './userProfile'
import {
  signInWithUsernamePassword,
  signOutCurrentUser,
  subscribeToAuthState,
} from '../firebase/auth'
import { isFirebaseConfigured } from '../firebase/app'
import type { AppRole, UserProfile } from '../types/auth'

type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'misconfigured'

type AuthContextValue = {
  status: AuthStatus
  user: User | null
  profile: UserProfile | null
  role: AppRole | null
  errorMessage: string | null
  isAdmin: boolean
  isOperator: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    isFirebaseConfigured() ? 'loading' : 'misconfigured',
  )
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const applySignedOut = useCallback(() => {
    setUser(null)
    setProfile(null)
    setStatus('unauthenticated')
  }, [])

  const resolveProfile = useCallback(async (authUser: User) => {
    setUser(authUser)
    const loaded = await loadUserProfile(authUser.uid)
    setProfile(loaded)
    setErrorMessage(null)
    setStatus('authenticated')
  }, [])

  useEffect(() => {
    if (!isFirebaseConfigured()) {
      setStatus('misconfigured')
      setErrorMessage(
        'Configurazione Firebase incompleta. Verificare le variabili VITE_FIREBASE_* in .env.local.',
      )
      return
    }

    const unsubscribe = subscribeToAuthState((authUser) => {
      if (!authUser) {
        applySignedOut()
        return
      }

      setStatus('loading')
      void (async () => {
        try {
          await resolveProfile(authUser)
        } catch (error) {
          setErrorMessage(mapAuthErrorToItalian(error))
          try {
            await signOutCurrentUser()
          } catch {
            // Ignora errori di logout forzato.
          }
          applySignedOut()
        }
      })()
    })

    return unsubscribe
  }, [applySignedOut, resolveProfile])

  const signIn = useCallback(
    async (username: string, password: string) => {
      setErrorMessage(null)
      setStatus('loading')
      try {
        const authUser = await signInWithUsernamePassword(username, password)
        await resolveProfile(authUser)
      } catch (error) {
        try {
          await signOutCurrentUser()
        } catch {
          // Ignora.
        }
        applySignedOut()
        setErrorMessage(mapAuthErrorToItalian(error))
        throw error
      }
    },
    [applySignedOut, resolveProfile],
  )

  const signOut = useCallback(async () => {
    setErrorMessage(null)
    try {
      await signOutCurrentUser()
    } finally {
      applySignedOut()
    }
  }, [applySignedOut])

  const clearError = useCallback(() => setErrorMessage(null), [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profile,
      role: profile?.role ?? null,
      errorMessage,
      isAdmin: profile?.role === 'admin',
      isOperator: profile?.role === 'operator' || profile?.role === 'admin',
      signIn,
      signOut,
      clearError,
    }),
    [status, user, profile, errorMessage, signIn, signOut, clearError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth deve essere usato entro AuthProvider.')
  }
  return ctx
}
