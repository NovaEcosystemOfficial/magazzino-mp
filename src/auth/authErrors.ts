import { FirebaseError } from 'firebase/app'

/** Messaggi di errore Auth in italiano (senza esporre dettagli tecnici inutili). */
export function mapAuthErrorToItalian(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case 'auth/invalid-email':
        return 'Credenziali non valide.'
      case 'auth/user-disabled':
        return 'Account disabilitato. Contattare l’amministratore.'
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Nome utente o password non corretti.'
      case 'auth/too-many-requests':
        return 'Troppi tentativi. Riprovare tra qualche minuto.'
      case 'auth/network-request-failed':
        return 'Connessione non disponibile. Verificare la rete e riprovare.'
      case 'auth/invalid-api-key':
      case 'auth/configuration-not-found':
        return 'Configurazione di autenticazione non disponibile.'
      default:
        return 'Accesso non riuscito. Riprovare o contattare l’amministratore.'
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'Accesso non riuscito. Riprovare.'
}
