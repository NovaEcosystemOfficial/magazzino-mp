import { BRAND_DEFINITIONS, type BrandId } from '../brands/brands'

type BrandSelectScreenProps = {
  /** Brand evidenziato (ultima scelta in localStorage), senza aprire ancora l’archivio. */
  highlightedBrandId?: BrandId
  onSelect: (brandId: BrandId) => void
}

const BRAND_HINTS: Record<BrandId, string> = {
  'marina-raphael': 'Archivio storico · database locale dedicato',
  'elie-saab': 'Archivio indipendente · anagrafica e movimenti separati',
  swarovski: 'Archivio indipendente · anagrafica e movimenti separati',
}

/**
 * Schermata post-splash: selezione esplicita del brand prima della dashboard.
 * Non scrive né migra IndexedDB: solo scelta UI.
 */
export function BrandSelectScreen({ highlightedBrandId, onSelect }: BrandSelectScreenProps) {
  return (
    <div className="brand-select-screen" role="main" aria-labelledby="brand-select-title">
      <div className="brand-select-screen__shell brand-select-screen__animate">
        <header className="brand-select-screen__header">
          <div className="brand-select-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark">MP</span>
        </div>
        <p className="brand-select-screen__eyebrow">Magazzino MP — Gestione Materie Prime</p>
          <h1 id="brand-select-title" className="brand-select-screen__title">
            Seleziona il brand
          </h1>
          <p className="brand-select-screen__subtitle">
            Ogni brand ha un archivio locale separato: articoli, giacenze e movimenti non si
            mischiano.
          </p>
        </header>

        <ul className="brand-select-screen__grid">
          {BRAND_DEFINITIONS.map((brand) => {
            const isHighlighted = brand.id === highlightedBrandId
            return (
              <li key={brand.id}>
                <button
                  type="button"
                  className={
                    isHighlighted
                      ? 'brand-select-screen__card brand-select-screen__card--highlighted'
                      : 'brand-select-screen__card'
                  }
                  onClick={() => onSelect(brand.id)}
                  aria-pressed={isHighlighted}
                >
                  <span className="brand-select-screen__card-mark" aria-hidden="true">
                    {brand.shortLabel}
                  </span>
                  <strong className="brand-select-screen__card-label">{brand.label}</strong>
                  <span className="brand-select-screen__card-hint">{BRAND_HINTS[brand.id]}</span>
                  {isHighlighted ? (
                    <span className="brand-select-screen__card-badge">Ultima scelta</span>
                  ) : (
                    <span className="brand-select-screen__card-action">Apri archivio</span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>

        <p className="brand-select-screen__footnote">
          Potrai cambiare brand in qualsiasi momento dalla barra laterale.
        </p>
      </div>
    </div>
  )
}
