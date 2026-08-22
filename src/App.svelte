<script lang="ts">
  import { fade } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import Background from "./lib/Background.svelte";
  import ArcMenu from "./lib/ArcMenu.svelte";
  import AccessibleCategoryNav from "./lib/AccessibleCategoryNav.svelte";
  import DetailSheet from "./lib/DetailSheet.svelte";
  import DesktopNav from "./lib/DesktopNav.svelte";
  import CategoryContent from "./lib/CategoryContent.svelte";
  import TypeText from "./lib/TypeText.svelte";
  import Login from "./lib/Login.svelte";
  import { categories, type SecurityIndicator, type VenturePublic, type LockerStatus, type LockerUnit } from "./lib/data";
  import { riskForHour, themeForRisk } from "./lib/risk";
  import {
    fetchSecurityIndicators,
    fetchVentures,
    fetchLockers,
    fetchMyPendingReceipt,
    fetchMyRentedLocker,
    fetchSubscriptionTiers,
    confirmLockerPayphonePayment,
    confirmSubscriptionPayphonePayment,
    ApiError,
    type LockerFromApi,
  } from "./lib/api";
  import { consumeAuthCallback, isAuthenticated, logout } from "./lib/auth.svelte";
  import { getUiVariant } from "./lib/abTest";

  // Test A/B de navegación — A: la rueda (ArcMenu). B: lista accesible
  // (AccessibleCategoryNav.svelte) — pedido real del cliente tras feedback
  // de que la rueda "no es usable". Se lee una sola vez al montar, no es
  // reactivo: la variante de un dispositivo no debe cambiar a media
  // sesión (ver abTest.ts para por qué queda fija).
  const uiVariant = getUiVariant();

  // Si el backend acaba de redirigir tras un login (Logto → GitHub → Logto
  // → backend → aquí), el access_token viene en location.hash — se
  // consume una sola vez, al montar, antes de cualquier otra cosa.
  consumeAuthCallback();
  let authed = $state(isAuthenticated());

  // auth.controller.ts redirige aquí con ?auth_error=... cuando Logto
  // rechaza el intento (ej. credenciales placeholder en desarrollo, ver
  // docs/dominio/10-despliegue-vps-vercel.md) — mensaje claro en vez de
  // dejar que el usuario se quede mirando un 500 crudo en otra pestaña.
  const AUTH_ERROR_MESSAGES: Record<string, string> = {
    logto_not_configured: "El login todavía no está disponible — Logto está pendiente de configurar.",
    // Ya no se exige dominio @epn.edu.ec (decisión de DGIP) — esto solo
    // sale si GitHub no entrega ningún correo en absoluto (perfil sin
    // correo público/verificado) — ver auth.controller.ts.
    correo_no_disponible:
      "No pudimos obtener tu correo desde GitHub. Revisa que tu correo esté verificado y público en tu perfil de GitHub, o usa la opción de correo electrónico.",
  };
  let authError = $state<string | null>(null);
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (code && AUTH_ERROR_MESSAGES[code]) {
      authError = AUTH_ERROR_MESSAGES[code];
      history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }

  // The wheel is a touch gesture wearing a UI — dragging a disc with a
  // mouse (or worse, tabbing to it with a keyboard) is a parlor trick, not
  // navigation. Mouse-and-keyboard visitors get a plain clickable nav and
  // a static content panel instead; touch (phone or tablet, any width)
  // keeps the dial, since that's the input it was actually designed for.
  let isDesktop = $state(false);
  $effect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(pointer: fine) and (min-width: 720px)");
    isDesktop = mq.matches;
    const handler = (e: MediaQueryListEvent) => (isDesktop = e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  let selectedIndex = $state(0);
  let sheetOpen = $state(false);
  let firstVisit = $state(false);

  // Navegación de móvil: dos pantallas que se REEMPLAZAN, nunca se
  // encinan. "inicio" = las 6 opciones grandes; "seccion" = el contenido
  // con un botón Volver bien visible. Es el patrón de Ajustes del iPhone:
  // no hay nada oculto, nada que deslizar, nada que recordar — y al no
  // haber capas superpuestas es imposible que algo intercepte un toque
  // (la causa de todos los bugs de doble toque de esta sesión).
  let mobileView = $state<"inicio" | "seccion">("inicio");

  // Dirección del último movimiento, para que la transición "empuje" hacia
  // el lado correcto: entrar va hacia adelante, Volver va hacia atrás.
  // Es lo que hace que se sienta como navegar en una consola (Wii/PS4) en
  // vez de un cambio brusco de pantalla.
  let navDir = $state<1 | -1>(1);

  // El botón "atrás" del teléfono/navegador sacaba de la app (y con el
  // login por GitHub caía en las URLs del flujo de OAuth que quedaron en
  // el historial, o sea de vuelta al login) porque la app NUNCA registraba
  // historial propio: al no haber ninguna entrada que consumir, "atrás"
  // salía del sitio directamente.
  //
  // Ahora entrar a una sección empuja una entrada real, así "atrás"
  // devuelve al menú — que es lo que cualquiera espera en un celular — en
  // vez de abandonar la app.
  function abrirSeccion(i: number) {
    selectedIndex = i;
    navDir = 1;
    mobileView = "seccion";
    if (typeof history !== "undefined") {
      history.pushState({ aeisView: "seccion", i }, "");
    }
  }

  function volverAlInicio() {
    // history.back() en vez de cambiar el estado a mano: así el botón
    // "Volver" de la pantalla y el "atrás" del teléfono recorren EL MISMO
    // historial. Si se hicieran por caminos distintos, el historial se
    // desincronizaría y "atrás" empezaría a saltarse pantallas.
    if (typeof history !== "undefined" && history.state?.aeisView === "seccion") {
      history.back();
      return;
    }
    navDir = -1;
    mobileView = "inicio";
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    // Entrada base del menú: sin esto, el primer "atrás" desde una sección
    // no tendría a dónde volver dentro de la app.
    if (!history.state?.aeisView) {
      history.replaceState({ aeisView: "inicio" }, "");
    }
    const onPop = (e: PopStateEvent) => {
      const vista = (e.state as { aeisView?: string } | null)?.aeisView;
      navDir = vista === "seccion" ? 1 : -1;
      mobileView = vista === "seccion" ? "seccion" : "inicio";
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  // Transición de pantalla estilo consola: deslizamiento + escala + fundido
  // con salida suave (cubicOut), que es lo que da la sensación "orgánica"
  // en vez de lineal/robótica. Solo entra la pantalla nueva — la anterior
  // se quita de una: sin superposición no hay forma de que dos capas
  // convivan y una intercepte toques (la causa de los bugs de esta sesión).
  //
  // ACCESIBILIDAD: si el sistema pide menos movimiento, la duración pasa a
  // 0 y el cambio es instantáneo. La animación nunca es un requisito para
  // entender qué pasó.
  // El tecleo del inicio arrancaba DETRÁS del splash: con ~570ms de
  // escritura contra 1500ms de splash, terminaba antes de que la pantalla
  // se descubriera y el usuario solo veía el texto ya completo ("ponle que
  // se escriba como en el login"). Se espera a que el splash se vaya.
  // Al volver al menú desde una sección el splash ya no existe, así que
  // ahí arranca de inmediato — sin tiempo muerto.
  function retrasoTecleo(base = 0): number {
    if (typeof document === "undefined") return base;
    return document.getElementById("boot") ? 1700 + base : base;
  }

  function consolaEntra(_node: Element, { dir = 1 }: { dir?: 1 | -1 }) {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return {
      duration: reduce ? 0 : 340,
      easing: cubicOut,
      css: (t: number, u: number) =>
        `transform: translate3d(${dir * 34 * u}px, 0, 0) scale(${0.965 + 0.035 * t});` +
        `opacity: ${t}; filter: brightness(${0.75 + 0.25 * t});`,
    };
  }

  // Seguridad's tone tracks the actual clock — not fixed like every other
  // module's theme — so it re-derives from the wall time on a slow tick
  // instead of once at load.
  let currentHour = $state(new Date().getHours());
  $effect(() => {
    const id = setInterval(() => (currentHour = new Date().getHours()), 60_000);
    return () => clearInterval(id);
  });
  const securityTheme = $derived(themeForRisk(riskForHour(currentHour)));

  // Los indicadores de seguridad ya no viven hardcodeados en data.ts — se
  // piden una vez al backend (mismo dato real, ahora en un solo lugar:
  // backend/src/security/indicators.ts). Si el backend no responde, la
  // sección de indicadores muestra el estado de error explícito de
  // CategoryContent en vez de romper — el mapa (SecurityMap) no depende de
  // este fetch en absoluto.
  let securityIndicators = $state<SecurityIndicator[] | null>(null);
  let securityIndicatorsError = $state(false);
  $effect(() => {
    fetchSecurityIndicators()
      .then((data) => {
        securityIndicators = data;
      })
      .catch(() => {
        securityIndicatorsError = true;
      });
  });

  // Directorio de emprendimientos — mismo patrón que los indicadores de
  // seguridad: se pide una vez al backend, con estado de error explícito
  // en vez de dejar la sección en blanco sin explicación.
  let ventures = $state<VenturePublic[] | null>(null);
  let venturesError = $state(false);
  $effect(() => {
    fetchVentures()
      .then((data) => {
        ventures = data;
      })
      .catch(() => {
        venturesError = true;
      });
  });

  // Casilleros reales — reemplaza los 9 casilleros MOCK que generaba
  // makeLockers() en data.ts. Mismo patrón de error explícito que
  // security/ventures arriba. El backend usa AVAILABLE/RESERVED/RENTED
  // (vocabulario de negocio); el frontend usa available/reserved/occupied
  // (vocabulario ya establecido en LockerStatus) — RENTED se traduce a
  // "occupied" porque para el estudiante que mira el mapa, "alguien ya lo
  // tiene" es lo mismo esté RESERVED-transferencia-pendiente o RENTED.
  const LOCKER_STATUS_MAP: Record<LockerFromApi["status"], LockerStatus> = {
    AVAILABLE: "available",
    RESERVED: "reserved",
    RENTED: "occupied",
  };
  let lockers = $state<LockerUnit[] | null>(null);
  let lockersError = $state(false);
  function loadLockers() {
    fetchLockers()
      .then((data) => {
        lockers = data.map((l) => ({
          id: l.id,
          number: l.code,
          zone: l.zone,
          status: LOCKER_STATUS_MAP[l.status],
        }));
        lockersError = false;
      })
      .catch(() => {
        lockersError = true;
      });
  }
  $effect(loadLockers);

  // Reserva propia (por transferencia) esperando comprobante — null si no
  // hay ninguna, o si el comprobante ya se confirmó. Deja que la grilla
  // habilite tocar ESE casillero puntual (y solo ese) aunque esté RESERVED,
  // para resubir la foto si el primer intento falló (red caída, foto
  // ilegible). El backend ya filtra por sesión — acá solo se guarda lo que
  // devuelve, nunca se asume nada del lado del cliente.
  let myPendingReceipt = $state<{ rentalId: string; lockerCode: string } | null>(null);
  function loadMyPendingReceipt() {
    if (!isAuthenticated()) return;
    fetchMyPendingReceipt()
      .then((data) => (myPendingReceipt = data))
      .catch(() => {
        // Silencioso a propósito: esto solo habilita un atajo (resubir sin
        // buscar el casillero en la grilla ya lo cubre igual, solo que
        // aparecería como bloqueado) — no es un dato crítico para mostrar
        // un error aparte.
      });
  }
  $effect(loadMyPendingReceipt);

  // El casillero que el estudiante ya tiene confirmado este periodo, si
  // hay uno — pedido real: en vez de que busque el suyo entre hasta 108,
  // la grilla lo distingue y lo deja tocar para ver el estado.
  let myRentedLocker = $state<{ lockerCode: string; zone: string } | null>(null);
  function loadMyRentedLocker() {
    if (!isAuthenticated()) return;
    fetchMyRentedLocker()
      .then((data) => (myRentedLocker = data))
      .catch(() => {
        // Silencioso a propósito, mismo criterio que loadMyPendingReceipt.
      });
  }
  $effect(loadMyRentedLocker);

  // Tras un alquiler/confirmación exitosos, la grilla necesita refrescar
  // disponibilidad + si sigue habiendo una reserva propia pendiente + si
  // ya hay un casillero propio confirmado (el que se acaba de confirmar).
  function onLockerRented() {
    loadLockers();
    loadMyPendingReceipt();
    loadMyRentedLocker();
  }

  // Tiers de Aportaciones — mismo patrón que casilleros: se piden al
  // backend (no viven hardcodeados en data.ts), público, con estado de
  // error explícito.
  let subscriptionTiers = $state<import("./lib/data").SubscriptionTierPublic[] | null>(null);
  let subscriptionTiersError = $state(false);
  function loadSubscriptionTiers() {
    fetchSubscriptionTiers()
      .then((data) => {
        subscriptionTiers = data;
        subscriptionTiersError = false;
      })
      .catch(() => {
        subscriptionTiersError = true;
      });
  }
  $effect(loadSubscriptionTiers);

  // Tras pagar en el widget de PayPhone, la Cajita de Pagos redirige la
  // página COMPLETA (no una navegación de SPA) de vuelta con
  // ?id=&clientTransactionId= en la URL — configurado una sola vez en
  // Payphone Developer, no por transacción (ver docs oficiales de
  // PayPhone y backend/src/shared/payment/payphone.client.ts). Se captura
  // acá, una vez al montar, y se re-confirma contra el backend (que a su
  // vez re-confirma contra la API real de PayPhone) antes de dar el pago
  // por bueno — nunca basta con que el navegador "diga" que volvió con
  // esos parámetros.
  let payphoneBanner = $state<{ ok: boolean; text: string } | null>(null);
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const ppId = params.get("id");
    const ppClientTxId = params.get("clientTransactionId");
    if (ppId && ppClientTxId) {
      history.replaceState(null, "", window.location.pathname + window.location.hash);
      // clientTransactionId puede ser el id de un LockerRental o de una
      // Subscription — la URL de respuesta de PayPhone es la MISMA para
      // toda la app (se configura una vez en Payphone Developer, no por
      // transacción), así que no hay forma de saber cuál es de antemano.
      // Se intenta primero como casillero; si el backend responde que ese
      // alquiler no existe, se reintenta como aportación.
      confirmLockerPayphonePayment(Number(ppId), ppClientTxId)
        .then(() => {
          payphoneBanner = { ok: true, text: "¡Pago con PayPhone confirmado! Tu casillero ya es tuyo." };
          loadLockers();
        })
        .catch((lockerErr) => {
          if (!(lockerErr instanceof ApiError) || lockerErr.status !== 404) {
            payphoneBanner = { ok: false, text: lockerErr instanceof ApiError ? lockerErr.message : "No se pudo confirmar el pago con PayPhone." };
            return;
          }
          confirmSubscriptionPayphonePayment(Number(ppId), ppClientTxId)
            .then(() => {
              payphoneBanner = { ok: true, text: "¡Pago con PayPhone confirmado! Tu aportación ya quedó activa." };
              loadSubscriptionTiers();
            })
            .catch((subErr) => {
              payphoneBanner = {
                ok: false,
                text: subErr instanceof ApiError ? subErr.message : "No se pudo confirmar el pago con PayPhone.",
              };
            });
        });
    }
  }

  const displayCategories = $derived(
    categories.map((c) => {
      if (c.id === "security") return { ...c, theme: securityTheme, security: securityIndicators ?? undefined };
      if (c.id === "community") return { ...c, ventures: ventures ?? undefined };
      if (c.id === "lockers" && lockers) return { ...c, lockers };
      if (c.id === "subscriptions" && subscriptionTiers) return { ...c, tiers: subscriptionTiers };
      return c;
    })
  );

  const activeCategory = $derived(displayCategories[selectedIndex]);
  // Handed to CategoryContent as a reference that doesn't change identity
  // just because you've navigated to some other section — see the comment
  // by <SecurityMapComp> for why that distinction is the whole point.
  const securityCategory = $derived(displayCategories.find((c) => c.id === "security") ?? null);
  // Mismo motivo que securityCategory: Casilleros es la grilla más pesada
  // (hasta 108 nodos animados) de las 5 secciones — sin una referencia
  // estable, CategoryContent la destruye y reconstruye entera cada vez que
  // se navega a otra categoría y se vuelve (auditoría de rendimiento móvil).
  const lockersCategory = $derived(displayCategories.find((c) => c.id === "lockers") ?? null);
  const bgOverride = $derived(
    activeCategory.id === "security" ? { dim: securityTheme.accentDim, deep: securityTheme.deep } : null
  );

  function openSheet() {
    sheetOpen = true;
  }

  // A first-time visitor has no reason to know the disc turns or that the
  // pill opens something — Nielsen's "visibility of system status": show
  // the affordance plainly instead of expecting it to be recalled from a
  // faint caption. Settles back to the compact hint after a look, or the
  // moment the visitor actually acts.
  $effect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = localStorage.getItem("aeis-onboarded") === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    firstVisit = true;
    try {
      localStorage.setItem("aeis-onboarded", "1");
    } catch {
      /* ignore */
    }
    const t = setTimeout(() => (firstVisit = false), 4200);
    return () => clearTimeout(t);
  });

  function dismissOnboarding() {
    firstVisit = false;
  }

  // Puerta de entrada: sin sesión, lo ÚNICO que se ve es Login.svelte — la
  // app (rueda, casilleros, mapa, etc.) queda detrás, ni se monta. Antes
  // Login era un overlay opcional que se abría con un botón; ahora es la
  // pantalla por defecto para cualquiera que no haya iniciado sesión
  // todavía, y la app real recién aparece al autenticarse (ver `authed`
  // más arriba — se recalcula solo en cada carga real de página, que es
  // justo lo que pasa tras el redirect de vuelta de Logto/GitHub).
</script>

{#if !authed}
  <Login onclose={() => {}} showBack={false} errorMessage={authError} />
{:else}
<div class="phone-frame" class:desktop={isDesktop}>
  <div class="screen" class:desktop={isDesktop}>
    <Background tint={sheetOpen ? "accent" : "navy"} override={bgOverride} />

    <div class="brandbar">
      <span class="brand-dot"></span>
      <span class="brand-name">AEIS</span>
      <img src="/aso.png" alt="AEIS" class="brand-mark" />
      <button class="auth-button" onclick={() => logout()} aria-label="Cerrar sesión">
        Cerrar sesión
      </button>
    </div>

    {#if payphoneBanner}
      <div class="auth-error-banner" class:ok={payphoneBanner.ok} role="alert">
        <span>{payphoneBanner.text}</span>
        <button onclick={() => (payphoneBanner = null)} aria-label="Cerrar aviso">×</button>
      </div>
    {/if}

    {#if isDesktop}
      <main class="desktop-main">
        <aside class="desktop-side">
          <DesktopNav
            categories={displayCategories}
            {selectedIndex}
            onselect={(i) => (selectedIndex = i)}
            vertical
          />
        </aside>
        <section class="desktop-stage">
          <div class="desktop-label">
            {#key activeCategory.id}
              <div in:fade={{ duration: 150 }}>
                <h1 class="desktop-title">{activeCategory.label}</h1>
                <p class="desktop-prompt">{activeCategory.prompt}</p>
              </div>
            {/key}
          </div>
          <div class="desktop-panel">
            <!-- Not keyed on activeCategory.id: that used to blow away and
                 rebuild CategoryContent (and the map inside it) on every
                 switch. Content now swaps instantly instead of fading in,
                 which is the right trade for not re-fetching a map. -->
            <div class="desktop-panel-inner">
              <CategoryContent
                category={activeCategory}
                {securityCategory}
                {lockersCategory}
                securityRisk={riskForHour(currentHour)}
                {securityIndicatorsError}
                {venturesError}
                {lockersError}
                {myPendingReceipt}
                {myRentedLocker}
                onlockerrented={onLockerRented}
                {subscriptionTiersError}
                onsubscribed={loadSubscriptionTiers}
                wide
              />
            </div>
          </div>
        </section>
      </main>
    {:else if uiVariant === "B"}
      <!-- Dos pantallas que se REEMPLAZAN, nunca se encinan (patrón de
           Ajustes del iPhone: lista → detalle → Volver). Todo lo que se
           puede hacer está a la vista: las 6 opciones en el inicio, y un
           Volver grande dentro de la sección. Nada oculto tras un gesto,
           un desplazamiento lateral ni un menú.

           Al no existir capas superpuestas, es estructuralmente imposible
           que algo intercepte un toque — que fue la causa de TODOS los
           bugs de doble toque de esta sesión (el scrim a pantalla
           completa, el panel deslizante que seguía capturando toques
           mientras se iba, el gesto de arrastre con sus carreras). -->
      <main class="mobile-main">
        {#key mobileView}
          <div class="view-slide" in:consolaEntra={{ dir: navDir }}>
            {#if mobileView === "inicio"}
              <!-- Tecleo de consola: el mismo TypeText que ya usaba la
                   rueda. Le da el carácter retrofuturista al arranque sin
                   costar nada de rendimiento (es solo texto). -->
              <div class="home-head">
                <TypeText
                  tag="h1"
                  class="home-title"
                  text="¿Qué necesitas?"
                  speed={38}
                  startDelay={retrasoTecleo()}
                />
                <TypeText
                  tag="p"
                  class="home-sub"
                  text="Toca una opción para entrar."
                  speed={16}
                  startDelay={retrasoTecleo(620)}
                />
              </div>
              <AccessibleCategoryNav
                categories={displayCategories}
                {selectedIndex}
                onopen={abrirSeccion}
              />
            {:else}
              <!-- Volver: texto + flecha, alto de 48px y ancho completo del
                   área táctil. Un ícono suelto de flecha obliga a interpretar;
                   la palabra "Volver" no se interpreta, se lee. -->
              <button class="back-btn" onclick={volverAlInicio}>
                <span class="back-arrow" aria-hidden="true">‹</span>
                Volver
              </button>
              <div class="mobile-content">
                <CategoryContent
                  category={activeCategory}
                  {securityCategory}
                  {lockersCategory}
                  securityRisk={riskForHour(currentHour)}
                  {securityIndicatorsError}
                  {venturesError}
                  {lockersError}
                  lockersLoading={lockers === null && !lockersError}
                  {myPendingReceipt}
                  {myRentedLocker}
                  onlockerrented={onLockerRented}
                  {subscriptionTiersError}
                  onsubscribed={loadSubscriptionTiers}
                  compact
                />
              </div>
            {/if}
          </div>
        {/key}
      </main>
    {:else}
      <main class="menu-layer" class:receded={sheetOpen}>
        <div class="top-copy">
          <div class="label-block">
            {#key activeCategory.id}
              <div in:fade={{ duration: 150 }}>
                <TypeText tag="h1" class="label" text={activeCategory.label} speed={34} />
                <TypeText
                  tag="p"
                  class="prompt-text"
                  text={activeCategory.prompt}
                  speed={14}
                  startDelay={activeCategory.label.length * 34 + 120}
                />
              </div>
            {/key}
          </div>
          <p class="swipe-hint" class:emphasize={firstVisit}>
            <span class="hint-arrow bounce-left">‹</span>
            {firstVisit ? "desliza el disco para elegir" : "desliza para elegir"}
            <span class="hint-arrow bounce-right">›</span>
          </p>
        </div>
        <div class="wheel-slot" onpointerdown={dismissOnboarding}>
          <ArcMenu bind:selectedIndex categories={displayCategories} locked={sheetOpen} onswipeup={openSheet} />
        </div>
        <div class="pill-slot">
          <button class="open-pill" class:emphasize={firstVisit} onclick={openSheet}>
            <span class="open-pill-arrow">︿</span>
            desliza arriba o toca aquí
          </button>
        </div>
      </main>

      <DetailSheet
        category={activeCategory}
        bind:open={sheetOpen}
        {securityCategory}
        {lockersCategory}
        securityRisk={riskForHour(currentHour)}
        {securityIndicatorsError}
        {venturesError}
        {lockersError}
        {myPendingReceipt}
        {myRentedLocker}
        onlockerrented={onLockerRented}
        {subscriptionTiersError}
        onsubscribed={loadSubscriptionTiers}
      />
    {/if}

  </div>
</div>
{/if}

<style>
  .phone-frame {
    height: 100dvh;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .screen {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .brandbar {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: max(18px, env(safe-area-inset-top)) 24px 0;
  }

  .brand-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }

  .brand-mark {
    width: 40px;
    height: 40px;
    object-fit: contain;
    margin-left: auto;
    filter: drop-shadow(0 0 6px var(--accent-glow));
  }

  .auth-button {
    margin-left: 10px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    color: var(--ink-1);
    font-family: var(--font-display, inherit);
    font-size: 10.5px;
    letter-spacing: 0.04em;
    white-space: nowrap;
    cursor: pointer;
  }
  /* Gateado a (hover: hover) — mismo hallazgo real que .unit:hover en
     CategoryContent.svelte: sin esto, el primer tap en móvil se "gasta"
     simulando hover y hace falta un segundo tap para que el botón
     realmente actúe. Este botón (Cerrar sesión) es de los que más se
     toca en la app — se había quedado fuera de todas las pasadas
     anteriores por auditoría de este mismo bug. */
  @media (hover: hover) and (pointer: fine) {
    .auth-button:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .auth-error-banner {
    position: relative;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 0 14px 4px;
    padding: 8px 12px;
    border-radius: 12px;
    background: rgba(239, 68, 68, 0.14);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #ffb4b4;
    font-size: 11.5px;
    line-height: 1.4;
  }
  .auth-error-banner button {
    background: none;
    border: none;
    color: inherit;
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0 2px;
  }

  .auth-error-banner.ok {
    background: rgba(33, 224, 160, 0.14);
    border-color: rgba(33, 224, 160, 0.35);
    color: var(--accent, #21e0a0);
  }

  .brand-name {
    font-family: var(--font-heading);
    font-size: 13px;
    letter-spacing: 0.3em;
    color: var(--ink-1);
  }

  /* Pantalla única de móvil: pestañas fijas + contenido. Sin position
     absoluta, sin z-index peleando con nada — no hay capas encimadas que
     puedan interceptar toques (que era el origen de los bugs de esta
     sesión). */
  .mobile-main {
    position: relative;
    z-index: 5;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .mobile-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Contenedor de la pantalla que entra — necesita ser el flex column
     completo para que el contenido interno siga repartiéndose igual. */
  .view-slide {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    will-change: transform, opacity;
  }

  .home-head {
    padding: 10px 22px 14px;
    flex-shrink: 0;
  }

  /* :global() porque estos elementos los CREA TypeText (efecto de tecleo),
     no este componente — el CSS con ámbito de App.svelte no alcanzaría al
     nodo de un hijo. Mismo motivo por el que .label/.prompt-text de la
     rueda ya estaban así más abajo. */
  :global(.home-title) {
    font-family: var(--font-heading);
    font-size: 26px;
    margin: 0;
    color: var(--ink-0, #eafff5);
  }

  :global(.home-sub) {
    margin: 4px 0 0;
    font-size: 13px;
    color: rgba(238, 244, 251, 0.6);
  }

  /* Objetivo táctil de 48px de alto (por encima del mínimo WCAG 2.5.5 de
     44px) y con la palabra "Volver" escrita: una flecha suelta hay que
     interpretarla, la palabra se lee y ya. Pegado arriba a la izquierda,
     que es donde la convención de iOS lo pone. */
  .back-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    align-self: flex-start;
    flex-shrink: 0;
    min-height: 48px;
    margin: 4px 12px 2px;
    padding: 0 14px 0 8px;
    border: none;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.06);
    color: var(--accent, #21e0a0);
    font-family: var(--font-heading, sans-serif);
    font-size: 15px;
    letter-spacing: 0.02em;
    cursor: pointer;
  }

  .back-arrow {
    font-size: 24px;
    line-height: 1;
    margin-top: -2px;
  }

  @media (hover: hover) and (pointer: fine) {
    .back-btn:hover {
      background: rgba(255, 255, 255, 0.11);
    }
  }

  .back-btn:active {
    transform: scale(0.97);
  }

  .menu-layer {
    position: relative;
    z-index: 5;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: clamp(10px, 2.6vh, 20px);
    padding-top: clamp(8px, 2vh, 20px);
    transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease;
  }

  .menu-layer.receded {
    transform: translateY(14px) scale(0.98);
    opacity: 0.3;
  }

  /* Antes label-block + swipe-hint eran hijos directos de .menu-layer,
     pegados arriba, y todo el espacio libre restante quedaba dentro de
     .wheel-slot (flex:1) — pero la rueda se ancla al fondo de ese espacio
     (ArcMenu .stage, justify-content:flex-end), así que ese hueco se veía
     entero ENTRE el texto y la rueda, no repartido. Envolver el texto en
     su propio flex:1 centrado lo baja hasta la mitad de ese espacio libre
     sin tocar la posición de la rueda (reporte real en celular). */
  .top-copy {
    /* flex-grow más alto que .wheel-slot (que se queda en 1) — reparte MÁS
       del espacio libre compartido hacia el texto sin mover ni un pixel el
       borde inferior de .wheel-slot (donde ArcMenu ancla la rueda), porque
       ese borde depende solo de la suma total de ambos más el alto fijo de
       .pill-slot, no de cómo se reparte el crecimiento entre los dos. */
    flex: 2;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(10px, 2.6vh, 20px);
  }

  /* Variante B (accesible) no tiene rueda que anclar — el flex:2 de arriba
     existe SOLO para repartir el espacio libre con .wheel-slot (que acá no
     existe). Sin este override, el encabezado se centraría en un hueco
     enorme y la lista de categorías, que es el contenido real, quedaría
     apretada abajo. */
  .accessible-top-copy {
    flex: 0 0 auto;
    padding-top: clamp(8px, 2vh, 16px);
  }

  .label-block {
    text-align: center;
    padding: 0 20px;
    flex: 0 0 auto;
  }

  /* :global() a propósito — TypeText.svelte renderiza este elemento, y el
     class="label" que le pasamos aquí llega como texto plano dentro de
     SU template, no del de App.svelte. El hash de scoped-CSS de Svelte
     solo se agrega a clases en elementos escritos literalmente en ESTE
     componente, así que sin :global() esta regla compila mal-scopeada
     (".label.svelte-XXXX") y nunca matchea nada — hallazgo real: llevaba
     así desde que se agregó TypeText aquí, el tamaño de letra nunca
     estuvo aplicando el clamp() de abajo. */
  :global(.label) {
    font-family: var(--font-heading);
    font-size: clamp(22px, 7vw, 28px);
    font-weight: 500;
    letter-spacing: 0.06em;
    margin: 0;
    color: var(--ink-0);
    text-shadow: 0 0 24px var(--accent-glow);
  }

  :global(.prompt-text) {
    margin: 6px 0 0;
    font-size: 13px;
    letter-spacing: 0.02em;
    color: var(--ink-1);
    line-height: 1.4;
  }

  .wheel-slot {
    width: 100%;
    flex: 1 1 auto;
    min-height: 130px;
  }

  /* Sits immediately under the wheel's own dots, not stranded in the
     leftover space — Gestalt proximity: the dial and its "confirm" action
     read as one control cluster only when they're actually close together. */
  .pill-slot {
    width: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .swipe-hint {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 22px;
    border-radius: 999px;
    background: var(--accent-ghost);
    border: 1px solid var(--accent-dim);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--ink-0);
    text-align: center;
    flex: 0 0 auto;
    text-transform: lowercase;
    transition: font-size 0.3s ease, padding 0.3s ease, background 0.3s ease, border-color 0.3s ease,
      box-shadow 0.3s ease;
  }

  .swipe-hint.emphasize {
    font-size: 13.5px;
    padding: 11px 24px;
    background: var(--accent-ghost);
    border-color: var(--accent);
    box-shadow: 0 0 22px var(--accent-glow);
  }

  .hint-arrow {
    display: inline-block;
    color: var(--accent);
    animation: hint-bounce 1.6s ease-in-out infinite;
  }

  .bounce-left {
    animation-name: hint-bounce-left;
  }

  .bounce-right {
    animation-name: hint-bounce-right;
  }

  @keyframes hint-bounce-left {
    0%,
    100% {
      transform: translateX(0);
      opacity: 0.7;
    }
    50% {
      transform: translateX(-4px);
      opacity: 1;
    }
  }

  @keyframes hint-bounce-right {
    0%,
    100% {
      transform: translateX(0);
      opacity: 0.7;
    }
    50% {
      transform: translateX(4px);
      opacity: 1;
    }
  }

  /* Antes: relleno plano de un solo verde + halo parejo alrededor + fuente
     del cuerpo — el combo clásico de "botón de plantilla genérica" (nada
     con textura o gradiente en este sistema, todo lo demás es outline/glow,
     así que un sólido plano destaca por las razones equivocadas). Ahora:
     degradado de 2 tonos DEL MISMO verde de marca (--accent → --accent-dim,
     ya definidos en app.css, no un tono inventado), sombra direccional
     (luz desde arriba, se apaga hacia abajo, en vez de un halo uniforme),
     ancho acotado a su contenido en vez de casi todo el viewport, y la
     misma familia tipográfica que el título de la categoría arriba
     (--font-heading) para que no se lean como dos sistemas distintos. */
  .open-pill {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    margin: 0 0 max(4px, env(safe-area-inset-bottom));
    padding: 11px 22px;
    width: fit-content;
    max-width: min(74%, 260px);
    border-radius: 999px;
    background: linear-gradient(165deg, var(--accent) 0%, var(--accent-dim) 100%);
    border: 1px solid rgba(255, 255, 255, 0.16);
    color: #010805;
    font-family: var(--font-heading);
    font-size: 13px;
    font-weight: 400;
    letter-spacing: 0.03em;
    text-transform: lowercase;
    text-shadow: none;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    flex: 0 0 auto;
    box-shadow: 0 -6px 16px var(--accent-glow), 0 10px 22px rgba(2, 6, 4, 0.5);
    animation: pill-breathe 2.4s ease-in-out infinite;
    transition: transform 0.25s ease;
  }

  .open-pill.emphasize {
    animation: pill-breathe-strong 1.3s ease-in-out infinite;
  }

  @keyframes pill-breathe-strong {
    0%,
    100% {
      transform: translateY(0) scale(1);
      box-shadow: 0 -6px 16px var(--accent-glow), 0 10px 22px rgba(2, 6, 4, 0.5);
    }
    50% {
      transform: translateY(-5px) scale(1.05);
      box-shadow: 0 -10px 28px var(--accent-glow), 0 14px 28px rgba(2, 6, 4, 0.55);
    }
  }

  .open-pill-arrow {
    font-size: 12px;
    line-height: 0.6;
    opacity: 0.9;
  }

  @keyframes pill-breathe {
    0%,
    100% {
      transform: translateY(0) scale(1);
      box-shadow: 0 -4px 14px var(--accent-glow), 0 8px 20px rgba(2, 6, 4, 0.45);
    }
    50% {
      transform: translateY(-3px) scale(1.02);
      box-shadow: 0 -7px 20px var(--accent-glow), 0 10px 24px rgba(2, 6, 4, 0.5);
    }
  }

  /* Desktop/web: the same interface adapted as a page section — not a fake
     phone mockup. No bezel, no notch, just a comfortably sized panel that
     scales with the actual browser window. */
  @media (min-width: 720px) {
    .phone-frame {
      background: radial-gradient(120% 120% at 50% 0%, #10131d 0%, #04050a 70%);
      padding: 5vh 24px;
    }

    .screen {
      width: min(460px, 92vw);
      height: min(780px, calc(100vh - 10vh));
      border-radius: 28px;
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.55), 0 0 0 1px var(--line-soft);
    }

    .brandbar {
      padding-top: 26px;
    }
  }

  /* Mouse-and-keyboard visitors get the whole viewport, not a phone-shaped
     card floating in dead space — a desktop browser window IS the frame,
     so the bezel, the max-width and the centering all come off. */
  .phone-frame.desktop {
    padding: 0;
    background: var(--bg-void);
    align-items: stretch;
  }

  .screen.desktop {
    width: 100%;
    height: 100dvh;
    max-width: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }

  .desktop-main {
    position: relative;
    z-index: 5;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(190px, 232px) 1fr;
    gap: 0;
  }

  .desktop-side {
    padding: 10px 16px 24px;
    border-right: 1px solid var(--line-soft);
    overflow-y: auto;
  }

  .desktop-stage {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  .desktop-label {
    padding: 10px 28px 6px;
  }

  .desktop-title {
    font-family: var(--font-heading);
    font-size: clamp(26px, 2.4vw, 36px);
    font-weight: 500;
    letter-spacing: 0.05em;
    margin: 0;
    color: var(--ink-0);
    text-shadow: 0 0 24px var(--accent-glow);
  }

  .desktop-prompt {
    margin: 6px 0 0;
    font-size: 13.5px;
    color: var(--ink-1);
  }

  .desktop-panel {
    flex: 1;
    min-height: 0;
    margin: 8px 20px 20px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--line-strong);
    overflow: hidden;
    display: flex;
  }

  .desktop-panel-inner {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
</style>
