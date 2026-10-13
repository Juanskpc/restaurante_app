/**
 * Catálogo de emojis para la carta: el que se ofrece al elegir el ícono de una categoría o de
 * un producto.
 *
 * ## Por qué una lista a mano y no «todos los emojis»
 *
 * Un selector completo son ~1.900 emojis y obliga a buscar entre banderas y signos del zodiaco
 * para encontrar una hamburguesa. Esto es la carta de un restaurante: lo que hace falta son
 * comida, bebida y servicio, en grupos que se reconocen de un vistazo. Quien quiera uno que no
 * esté lo escribe en el campo —el selector **no sustituye** al texto libre, lo acompaña.
 *
 * ## Las palabras clave están en español y son de cocina, no de Unicode
 *
 * El nombre oficial de 🌮 es «taco», pero quien lo busca puede escribir «mexicana». El nombre de
 * 🍺 es «beer mug» y aquí nadie va a escribir «mug». Cada entrada lleva los términos con los que
 * de verdad se busca en una carta colombiana, sin tildes (la búsqueda normaliza las dos partes).
 */

export interface EmojiCarta {
  /** El emoji. Es el valor que se guarda en `carta_categoria.icono` / `carta_producto.icono`. */
  e: string;
  /** Cómo se llama en la carta. Se enseña en el tooltip. */
  n: string;
  /** Otros términos con los que alguien lo buscaría. Sin tildes. */
  k?: string;
}

export interface GrupoEmoji {
  nombre: string;
  emojis: EmojiCarta[];
}

export const GRUPOS_EMOJI: GrupoEmoji[] = [
  {
    nombre: 'Comida rápida',
    emojis: [
      { e: '🍔', n: 'Hamburguesa', k: 'burger carne res' },
      { e: '🍟', n: 'Papas fritas', k: 'papa french' },
      { e: '🌭', n: 'Perro caliente', k: 'hot dog salchicha perrito' },
      { e: '🍕', n: 'Pizza', k: 'porcion italiana' },
      { e: '🥙', n: 'Shawarma', k: 'pita arabe durum kebab wrap' },
      { e: '🌯', n: 'Burrito', k: 'wrap mexicana envuelto' },
      { e: '🌮', n: 'Taco', k: 'mexicana' },
      { e: '🥪', n: 'Sándwich', k: 'sanduche emparedado' },
      { e: '🧆', n: 'Falafel', k: 'bolas arabe' },
      { e: '🥟', n: 'Empanada', k: 'empanadas dumpling pastel' },
      { e: '🍗', n: 'Pollo frito', k: 'presa pierna alita broaster' },
      { e: '🍖', n: 'Costilla', k: 'carne hueso asado chuleta' },
    ],
  },
  {
    nombre: 'Platos fuertes',
    emojis: [
      { e: '🍽️', n: 'Plato', k: 'comida corriente almuerzo general menu' },
      { e: '🍛', n: 'Plato con arroz', k: 'bandeja curry almuerzo ejecutivo' },
      { e: '🍚', n: 'Arroz', k: 'blanco chino' },
      { e: '🥘', n: 'Cazuela', k: 'paella guiso sudado cocido' },
      { e: '🍲', n: 'Sancocho', k: 'sopa caldo olla ajiaco mondongo' },
      { e: '🥣', n: 'Crema', k: 'sopa tazon cereal' },
      { e: '🍝', n: 'Pasta', k: 'espagueti italiana macarrones' },
      { e: '🥩', n: 'Carne', k: 'churrasco lomo res bife punta' },
      { e: '🍢', n: 'Pincho', k: 'brocheta chuzo anticucho' },
      { e: '🫔', n: 'Tamal', k: 'hoja envuelto' },
      { e: '🥞', n: 'Patacón', k: 'panqueque arepa tortilla pancake' },
      { e: '🌽', n: 'Mazorca', k: 'maiz choclo' },
    ],
  },
  {
    nombre: 'Del mar',
    emojis: [
      { e: '🐟', n: 'Pescado', k: 'mojarra tilapia pargo frito' },
      { e: '🍣', n: 'Sushi', k: 'japonesa nigiri' },
      { e: '🍤', n: 'Camarón', k: 'langostino apanado mariscos' },
      { e: '🦐', n: 'Camarones', k: 'mariscos coctel' },
      { e: '🦞', n: 'Langosta', k: 'mariscos' },
      { e: '🦀', n: 'Cangrejo', k: 'jaiba mariscos' },
      { e: '🦑', n: 'Calamar', k: 'anillos mariscos' },
      { e: '🐙', n: 'Pulpo', k: 'mariscos' },
      { e: '🦪', n: 'Ostra', k: 'ostras mariscos concha' },
      { e: '🍱', n: 'Bandeja japonesa', k: 'bento combo sushi' },
      { e: '🥡', n: 'Para llevar', k: 'domicilio caja china llevar' },
      { e: '🍜', n: 'Ramen', k: 'sopa fideos asiatica' },
    ],
  },
  {
    nombre: 'Desayuno',
    emojis: [
      { e: '🍳', n: 'Huevos', k: 'desayuno fritos pericos revueltos' },
      { e: '🥓', n: 'Tocineta', k: 'bacon desayuno' },
      { e: '🥐', n: 'Croissant', k: 'cuernito panaderia' },
      { e: '🥖', n: 'Pan', k: 'baguette panaderia' },
      { e: '🍞', n: 'Pan tajado', k: 'tostada molde' },
      { e: '🥯', n: 'Bagel', k: 'rosca pan' },
      { e: '🧇', n: 'Waffle', k: 'wafle desayuno' },
      { e: '🥛', n: 'Leche', k: 'vaso lacteo' },
      { e: '🧈', n: 'Mantequilla', k: 'margarina' },
      { e: '🧀', n: 'Queso', k: 'quesito costeño' },
      { e: '🥚', n: 'Huevo', k: 'desayuno' },
      { e: '🫓', n: 'Arepa', k: 'tortilla pan plano' },
    ],
  },
  {
    nombre: 'Postres y dulces',
    emojis: [
      { e: '🍰', n: 'Torta', k: 'ponque pastel porcion postre' },
      { e: '🎂', n: 'Torta de cumpleaños', k: 'pastel celebracion' },
      { e: '🧁', n: 'Cupcake', k: 'ponque magdalena' },
      { e: '🍩', n: 'Dona', k: 'donut rosquilla' },
      { e: '🍪', n: 'Galleta', k: 'cookie' },
      { e: '🍫', n: 'Chocolate', k: 'chocolatina barra' },
      { e: '🍦', n: 'Helado', k: 'cono suave' },
      { e: '🍨', n: 'Copa de helado', k: 'sundae postre' },
      { e: '🍧', n: 'Raspado', k: 'granizado cholado hielo' },
      { e: '🍮', n: 'Flan', k: 'postre natilla caramelo' },
      { e: '🍬', n: 'Dulce', k: 'caramelo confite mecato' },
      { e: '🍯', n: 'Miel', k: 'arequipe dulce' },
    ],
  },
  {
    nombre: 'Frutas y verduras',
    emojis: [
      { e: '🍎', n: 'Manzana', k: 'fruta' },
      { e: '🍌', n: 'Banano', k: 'platano fruta' },
      { e: '🍓', n: 'Fresa', k: 'fruta' },
      { e: '🍊', n: 'Naranja', k: 'mandarina citrico fruta jugo' },
      { e: '🍋', n: 'Limón', k: 'citrico fruta' },
      { e: '🍍', n: 'Piña', k: 'fruta' },
      { e: '🥭', n: 'Mango', k: 'fruta' },
      { e: '🍉', n: 'Sandía', k: 'patilla fruta' },
      { e: '🥑', n: 'Aguacate', k: 'palta' },
      { e: '🥗', n: 'Ensalada', k: 'verduras vegetariano saludable' },
      { e: '🥦', n: 'Brócoli', k: 'verdura vegetal' },
      { e: '🍄', n: 'Champiñón', k: 'hongo setas' },
    ],
  },
  {
    nombre: 'Bebidas',
    emojis: [
      { e: '🥤', n: 'Gaseosa', k: 'refresco soda vaso bebida' },
      { e: '🧃', n: 'Jugo en caja', k: 'juguito bebida' },
      { e: '🧊', n: 'Hielo', k: 'frio cubo' },
      { e: '☕', n: 'Café', k: 'tinto capuchino caliente' },
      { e: '🫖', n: 'Té', k: 'tetera infusion aromatica' },
      { e: '🧋', n: 'Malteada', k: 'batido smoothie bubble tea' },
      { e: '🥥', n: 'Coco', k: 'agua de coco fruta' },
      { e: '🍹', n: 'Cóctel tropical', k: 'limonada coctel bebida' },
      { e: '🍺', n: 'Cerveza', k: 'pola birra michelada' },
      { e: '🍻', n: 'Cervezas', k: 'brindis pola jarras' },
      { e: '🍷', n: 'Vino', k: 'copa tinto' },
      { e: '🥂', n: 'Brindis', k: 'champaña copas celebracion' },
      { e: '🍸', n: 'Cóctel', k: 'martini trago coctel' },
      { e: '🥃', n: 'Whisky', k: 'ron aguardiente trago licor' },
      { e: '🍾', n: 'Botella', k: 'champaña vino licor' },
      { e: '🧉', n: 'Mate', k: 'infusion bebida' },
    ],
  },
  {
    nombre: 'Servicio y otros',
    emojis: [
      { e: '🛒', n: 'Tienda', k: 'carrito mercado abarrotes supermercado' },
      { e: '🏪', n: 'Minimercado', k: 'tienda local' },
      { e: '🍴', n: 'Cubiertos', k: 'tenedor cuchillo mesa' },
      { e: '🥂', n: 'Para celebrar', k: 'eventos fiesta' },
      { e: '👨‍🍳', n: 'Chef', k: 'cocinero cocina especial' },
      { e: '🔥', n: 'Picante', k: 'fuego parrilla asado brasa' },
      { e: '🌶️', n: 'Ají', k: 'picante chile salsa' },
      { e: '🧂', n: 'Sal', k: 'salero condimento aliño' },
      { e: '🥫', n: 'Enlatado', k: 'lata conserva salsa' },
      { e: '🧺', n: 'Canasta', k: 'combo picada para compartir' },
      { e: '🎁', n: 'Combo', k: 'promocion regalo paquete' },
      { e: '⭐', n: 'Recomendado', k: 'estrella especial favorito destacado' },
      { e: '🏆', n: 'Lo más vendido', k: 'top premio mejor' },
      { e: '🆕', n: 'Nuevo', k: 'novedad reciente' },
      { e: '🌱', n: 'Vegetariano', k: 'vegano verde planta saludable' },
      { e: '🛵', n: 'Domicilio', k: 'moto entrega delivery envio' },
    ],
  },
];

/** Quita tildes y pasa a minúsculas, para que «ají» encuentre «aji» y al revés. */
export function normalizar(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
