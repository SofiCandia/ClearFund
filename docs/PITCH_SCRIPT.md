# Guion del video pitch (2:45)

## (a) Problema — 0:00 a 0:35

**Locución:**  
“Cuando donamos, muchas veces solo vemos un comprobante de pago. No sabemos
cuándo llegó el dinero, qué se compró ni si el proyecto terminó. Y para
organizaciones pequeñas, las comisiones y las transferencias internacionales
pueden hacer que una donación pequeña no alcance. ClearFun parte de una idea
simple: la confianza debe poder comprobarse, no solo prometerse.”

**En pantalla:**  
Título “¿A dónde fue mi donación?”, seguida de una vista sencilla de campaña
con meta, saldo retenido e hitos.

## (b) Solución — 0:35 a 1:05

**Locución:**  
“ClearFun retiene cada aporte en un contrato inteligente de Stellar y libera
los fondos por etapas. La organización publica evidencia para cada hito y un
grupo independiente de verificadores la revisa. Cada voto, aporte y
liberación queda registrado públicamente. Si una campaña vence sin completar
sus etapas, el contrato permite a los donantes reclamar su parte de los fondos
que todavía no se liberaron.”

**En pantalla:**  
Animación del flujo Donantes → Escrow → Evidencia → Verificadores → Organización.
Resaltar el umbral de aprobación M-de-N.

## (c) Cómo funciona: demo — 1:05 a 2:10

**Locución:**  
“Veamos la campaña de agua potable para una escuela rural. Aquí están la
meta, la recaudación, los dos hitos y las direcciones de sus verificadores.
Abrimos el timeline y comprobamos cada evento y su transacción en Stellar
Expert. La organización adjunta el hash de su evidencia; el primer verificador
aprueba y el hito todavía espera el segundo voto. Al llegar al umbral, el
contrato libera automáticamente solo el monto de esa etapa. En el panel de
auditoría comparamos ingresos, liberaciones y saldo retenido. También podemos
ver otra campaña completada y una tercera que todavía está recaudando.”

**En pantalla:**

1. Abrir el explorador de campañas y entrar a “Agua potable para escuela
   rural”.
2. Mostrar porcentaje, hitos y timeline con enlace de Stellar Expert.
3. Mostrar el estado EvidenceSubmitted y la primera aprobación.
4. Mostrar la campaña completada y el balance/auditoría.
5. Mostrar brevemente campaña a medio recaudar.

## (d) Stellar — 2:10 a 2:45

**Locución:**  
“ClearFun usa contratos Soroban en Stellar y los Stellar Asset Contracts
para XLM y activos como USDC. Las autorizaciones las firma la wallet del
usuario: el backend prepara la transacción, pero nunca recibe sus claves. La
red ofrece comisiones bajas y confirmación que normalmente ocurre en pocos
segundos, haciendo más prácticas las microdonaciones. La demo corre en
Testnet: el siguiente paso es una revisión de seguridad independiente antes
de pensar en producción. ClearFun: cada aporte visible, cada etapa verificable.”

**En pantalla:**  
Mostrar el contrato en Stellar Expert, una transacción de liberación y el
mensaje “Testnet — no usar fondos reales”.
