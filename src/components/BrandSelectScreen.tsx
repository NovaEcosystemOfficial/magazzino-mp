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
      <div className="brand-select-screen__card brand-select-screen__animate">
        <div className="brand-select-screen__logo" aria-hidden="true">
          <span className="splash-screen__logo-mark" />
        </div>

        <p className="brand-select-screen__eyebrow">Magazzino MP</p>
        <h1 id="brand-select-title" className="brand-select-screen__title">
          Seleziona il brand
        </h1>
        <p className="brand-select-screen__subtitle">
          Ogni brand ha un archivio locale separato: articoli, giacenze e movimenti non si
          mischiano.
        </p>

        <ul className="brand-select-screen__list">
          {BRAND_DEFINITIONS.map((brand) => {
            const isHighlighted = brand.id === highlightedBrandId
            return (
              <li key={brand.id}>
                <button
                  type="button"
                  className={
                    isHighlighted
                      ? 'brand-select-screen__option brand-select-screen__option--highlighted'
                      : 'brand-select-screen__option'
                  }
                  onClick={() => onSelect(brand.id)}
                >
                  <span className="brand-select-screen__option-mark" aria-hidden="true">
                    {brand.shortLabel}
                  </span>
                  <span className="brand-select-screen__option-text">
                    <strong className="brand-select-screen__option-label">{brand.label}</strong>
                    <span className="brand-select-screen__option-hint">{BRAND_HINTS[brand.id]}</span>
                  </span>
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
