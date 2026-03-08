
# BRIEF TECHNIQUE REMOTION — STRUCTURE VIDÉO AFFILIATION
# À donner à Codex pour régénérer le pipeline Remotion

## OBJECTIF
Recrée complètement le template Remotion dans pipeline.js.
Durée cible : 25-35 secondes. Format 1080x1920 (9:16). 30fps.
Le template doit être réutilisable pour N'IMPORTE quel outil affilié.

---

## STRUCTURE DES 7 SCÈNES

### SCÈNE 1 — HOOK (0-3 sec) [frames 0-90]
**Objectif : créer la curiosité en 3 secondes**

Animations Remotion :
- Fond noir total
- Texte hook apparaît mot par mot avec spring() ultra rapide
- Chaque mot : scale 0 → 1.2 → 1 (overshoot)
- Dernier mot en couleur de marque avec glow effect
- Légère vibration de l'écran (interpolate sur translateX ±3px)
- Son d'impact suggéré dans les commentaires

Code pattern :
```jsx
const word = interpolate(frame, [0, 5], [0, 1], {extrapolateRight: 'clamp'})
const glow = `0 0 20px ${brandColor}`
```

Exemple texte généré par Claude :
"Personne ne parle de CET outil… pourtant il change tout."

---

### SCÈNE 2 — PROBLÈME (3-10 sec) [frames 90-300]
**Objectif : le viewer se reconnaît**

Animations Remotion :
- Fond reste sombre, léger gradient vers la couleur de marque en bas
- 2-3 bullet points arrivent de la gauche un par un (staggered)
- Chaque bullet : translateX -100 → 0 avec spring()
- Emoji devant chaque problème qui pulse (scale 1 → 1.2 → 1)
- Fond légèrement rouge/orange pour l'émotion négative

Code pattern :
```jsx
const slideIn = (startFrame) => interpolate(
  frame, [startFrame, startFrame + 15], [-100, 0],
  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
   easing: Easing.out(Easing.back(1.5))}
)
```

---

### SCÈNE 3 — SOLUTION (10-18 sec) [frames 300-540]
**Objectif : présenter l'outil comme LA réponse**

Animations Remotion :
- Flash blanc rapide (3 frames) pour marquer la transition
- Logo de l'outil scale-in depuis 0 avec spring() (mass: 0.5, damping: 8)
- Nom de l'outil apparaît lettre par lettre (typewriter effect)
- Tagline fade-in en dessous
- Particules légères qui montent (10-15 points colorés)
- Fond change vers couleur de marque en gradient

Code pattern :
```jsx
// Flash transition
const flash = interpolate(frame, [300, 303, 306], [0, 1, 0])

// Typewriter
const charCount = Math.floor(interpolate(frame, [310, 340], [0, toolName.length]))
const displayText = toolName.substring(0, charCount)

// Particles
{particles.map((p, i) => (
  <div style={{
    position: 'absolute',
    left: p.x,
    top: interpolate(frame, [300, 540], [p.startY, p.startY - 200]),
    opacity: interpolate(frame, [300, 540], [1, 0]),
    width: p.size, height: p.size,
    borderRadius: '50%',
    background: brandColor
  }}/>
))}
```

---

### SCÈNE 4 — DÉMO APP (18-28 sec) [frames 540-840]
**⭐ LA SCÈNE LA PLUS IMPORTANTE — montre le vrai produit**

Animations Remotion :
- Mockup de téléphone 3D (CSS perspective) qui apparaît
- À l'intérieur du téléphone : screenshot de l'interface de l'outil
- Curseur animé qui clique sur des éléments de l'interface
- Zoom progressif sur les features clés (scale 1 → 1.3)
- Annotations qui apparaissent (flèches + labels)
- Effet "avant/après" si pertinent

IMPORTANT - Pour les screenshots :
Claude génère une représentation SVG stylisée de l'interface
(pas de vraie capture — une interface simplifiée qui ressemble à l'outil)

Code pattern :
```jsx
// Phone mockup 3D
<div style={{
  perspective: 800,
  transform: `rotateY(${interpolate(frame, [540, 600], [25, 0])}deg)`,
  transition: 'all 0.3s'
}}>
  <div style={{
    width: 300, height: 550,
    borderRadius: 40,
    border: '8px solid #333',
    background: '#fff',
    overflow: 'hidden',
    boxShadow: `0 30px 80px rgba(0,0,0,0.5), 0 0 40px ${brandColor}44`
  }}>
    {/* Interface SVG de l'outil */}
    <AppInterfaceMockup tool={toolData} frame={frame} />
  </div>
</div>

// Curseur animé
<div style={{
  position: 'absolute',
  left: interpolate(frame, [600, 650, 700, 750], [150, 200, 180, 220]),
  top: interpolate(frame, [600, 650, 700, 750], [300, 280, 350, 320]),
}}>🖱️</div>

// Annotations
<div style={{
  opacity: interpolate(frame, [660, 680], [0, 1]),
  transform: `scale(${spring({frame: frame - 660, fps, config: {damping: 10}})})`,
}}>✨ Génère en 1 clic</div>
```

---

### SCÈNE 5 — BÉNÉFICES (28-32 sec) [frames 840-960]
**Bénéfices, pas features**

Animations Remotion :
- 3 bénéfices en cards qui pop (scale 0 → 1 staggered)
- Chiffre clé en très grand (ex: "10x") qui compte vers le haut
- Fond vert/positif pour l'émotion
- Icônes emoji qui rebondissent

Code pattern :
```jsx
// Counter animé
const count = Math.floor(interpolate(frame, [840, 900], [0, targetNumber]))

// Cards staggered
{benefits.map((b, i) => (
  <div style={{
    transform: `scale(${spring({
      frame: frame - 840 - (i * 10),
      fps,
      config: {damping: 12, stiffness: 200}
    })})`
  }}>{b}</div>
))}
```

---

### SCÈNE 6 — PREUVE SOCIALE (32-34 sec) [frames 960-1020]
**Rassure le viewer**

Animations Remotion :
- Étoiles ⭐⭐⭐⭐⭐ qui apparaissent une par une
- Note (ex: 4.8/5) qui s'incrémente
- Nombre d'utilisateurs qui compte (ex: "12,000+ users")
- Badge "Viral TikTok" ou "Trending" qui pulse

---

### SCÈNE 7 — CTA (34-35 sec) [frames 1020-1050]
**Dis exactement quoi faire**

Animations Remotion :
- Fond couleur de marque full screen
- Texte CTA bounce-in depuis le bas
- Flèche animée qui pointe vers le bas (lien en bio)
- Bouton qui pulse avec glow
- Lien affilié visible en petit

Code pattern :
```jsx
// Bouton pulse
const pulse = 1 + 0.05 * Math.sin(frame * 0.3)
<div style={{
  transform: `scale(${pulse})`,
  boxShadow: `0 0 ${20 + 10 * Math.sin(frame * 0.3)}px ${brandColor}`
}}>
  Lien en bio ↓
</div>
```

---

## COMPOSANT AppInterfaceMockup

Claude doit générer ce composant en analysant l'outil.
Pour ThumbnailCreator, ça ressemble à :

```jsx
function AppInterfaceMockup({ tool, frame }) {
  // Barre de navigation
  // Zone d'upload ou input
  // Bouton principal (animé)
  // Preview du résultat
  // Le tout en SVG/JSX stylisé avec les couleurs de l'outil
  
  const typing = Math.floor(interpolate(frame, [600, 650], [0, 20]))
  
  return (
    <div style={{fontFamily: 'sans-serif', padding: 16}}>
      {/* Header de l'app */}
      <div style={{background: tool.color, padding: 12, color: 'white'}}>
        {tool.name}
      </div>
      {/* Interface principale */}
      <div style={{padding: 16}}>
        <input 
          style={{width: '100%', padding: 8, border: `2px solid ${tool.color}`}}
          value={"Mon titre vidéo...".substring(0, typing)}
          readOnly
        />
        {frame > 660 && (
          <div style={{
            marginTop: 12,
            background: tool.color,
            color: 'white',
            padding: 12,
            borderRadius: 8,
            textAlign: 'center',
            transform: `scale(${spring({frame: frame - 660, fps: 30, config: {damping: 10}})})`
          }}>
            ✨ Générer la thumbnail
          </div>
        )}
        {frame > 720 && (
          <div style={{
            marginTop: 12,
            background: '#f0f0f0',
            borderRadius: 8,
            height: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: interpolate(frame, [720, 750], [0, 1])
          }}>
            🖼️ Thumbnail générée !
          </div>
        )}
      </div>
    </div>
  )
}
```

---

## INSTRUCTIONS POUR CODEX

1. Intègre cette structure dans le générateur de pipeline.js
2. Claude (via OpenRouter) doit remplir :
   - Le texte du hook (curiosité)
   - Les 2-3 problèmes (empathie)
   - Le tagline de l'outil
   - Les 3 bénéfices (résultats, pas features)
   - Le texte CTA
   - Les couleurs de marque (brandColor)
   - Le composant AppInterfaceMockup spécifique à l'outil

3. Le template Remotion doit accepter ces props :
```js
{
  hook: "string",
  problems: ["string", "string"],
  toolName: "string", 
  tagline: "string",
  brandColor: "#hexcode",
  benefits: ["string", "string", "string"],
  rating: 4.8,
  userCount: "12,000+",
  ctaText: "string",
  affiliateUrl: "string",
  appInterface: "jsx string généré par Claude"
}
```

4. Supprime output/thumbnailcreator et recrée tout
5. Lance le rendu et vérifie que le MP4 fait 25-35 secondes
