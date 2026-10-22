'use strict';

// Real films in Indian cinemas in October 2026 and real theatres, so the demo
// feels like the real thing. Film details and posters come from TMDB
// (themoviedb.org) and are linked from TMDB's image CDN with attribution in
// the UI. Showtimes and prices are generated: this is a portfolio demo and is
// not affiliated with any studio or cinema.

const TMDB_IMG = 'https://image.tmdb.org/t/p';

const MOVIES = [
  {
    id: 'jailer-2',
    tmdbId: 1234139,
    title: 'Jailer 2',
    language: 'Tamil',
    genres: ['Action', 'Comedy'],
    runtimeMinutes: 163,
    certification: null,
    rating: 8.0,
    releaseDate: '2026-10-14',
    poster: 'upwdEyhhYZ7pT2hD535fr2MGfpx.jpg',
    backdrop: 'zpHTOdRl7GEPqFsDGqsN6Hi9Ylt.jpg',
    director: 'Nelson',
    cast: ['Rajinikanth', 'S. J. Suryah', 'Ramya Krishnan', 'Vidya Balan'],
    overview:
      "When a dangerous syndicate expands its reach to threaten his family's peace, retired jailer Tiger Muthuvel Pandian goes undercover as a driver to take on ruthless new enemies.",
  },
  {
    id: 'ranabaali',
    tmdbId: 1389379,
    title: 'Ranabaali',
    language: 'Telugu',
    genres: ['History', 'Action', 'Drama'],
    runtimeMinutes: 179,
    certification: null,
    rating: null,
    releaseDate: '2026-10-15',
    poster: 'cXaCyYYbafVyMrs8rwKmxezBYPJ.jpg',
    backdrop: 'xpImgnsxuqb3VOp0QRtXTS5uBRi.jpg',
    director: 'Rahul Sankrityan',
    cast: ['Vijay Deverakonda', 'Rashmika Mandanna', 'Arnold Vosloo'],
    overview:
      'Set in 19th-century British India, a fierce leader rises from a drought-stricken land to fight colonial oppression and atrocities.',
  },
  {
    id: 'drishyam-the-conclusion',
    tmdbId: 1269325,
    title: 'Drishyam: The Conclusion',
    language: 'Hindi',
    genres: ['Thriller', 'Drama', 'Mystery', 'Crime'],
    runtimeMinutes: 148,
    certification: null,
    rating: 7.6,
    releaseDate: '2026-10-02',
    poster: '67FsF2kpgEZ1T5Qos4adgqm9dLf.jpg',
    backdrop: 'nq73eRdEooripf3k0XHLtX14zyC.jpg',
    director: 'Abhishek Pathak',
    cast: ['Ajay Devgn', 'Tabu', 'Shriya Saran', 'Jaideep Ahlawat'],
    overview:
      "Years after outsmarting the police, Vijay Salgaonkar's past resurfaces when new evidence threatens to expose his secret, and he must outwit the system once again to save his family.",
  },
  {
    id: 'udta-teer',
    tmdbId: 1375156,
    title: 'Udta Teer',
    language: 'Hindi',
    genres: ['Comedy', 'Action'],
    runtimeMinutes: 137,
    certification: null,
    rating: null,
    releaseDate: '2026-10-23',
    poster: 'tvICKypVlW7Iio4KVs7NousbSKi.jpg',
    backdrop: 'ncVecUcDZe1EOWtHaU2f8BFvbx4.jpg',
    director: 'Aakash Kaushik',
    cast: ['Ayushmann Khurrana', 'Sara Ali Khan', 'Rahul Bose'],
    overview: 'An amnesiac Pakistani spy wakes up believing he is a patriotic Indian counter-terrorism officer.',
  },
  {
    id: 'prahaar',
    tmdbId: 1081010,
    title: 'Prahaar: The Untold Story of Ujjwal Nikam',
    language: 'Hindi',
    genres: ['Crime', 'Drama'],
    runtimeMinutes: 141,
    certification: 'UA16+',
    rating: null,
    releaseDate: '2026-10-16',
    poster: 'wTrBTNfHHmpPwiB9rpn0tGbSW1m.jpg',
    backdrop: '8S2DXdKY23wfYq4v0awYXov4c8g.jpg',
    director: 'Avinash Arun',
    cast: ['Rajkummar Rao', 'Wamiqa Gabbi', 'Jaideep Ahlawat'],
    overview:
      'Public prosecutor Ujjwal Nikam leads the prosecution of Ajmal Kasab after the 26/11 Mumbai attacks, carrying the immense burden of a case that will define his legacy.',
  },
  {
    id: 'nayyi-navelli',
    tmdbId: 1654581,
    title: 'Nayyi Navelli',
    language: 'Hindi',
    genres: ['Comedy', 'Fantasy', 'Drama'],
    runtimeMinutes: null,
    certification: 'UA16+',
    rating: null,
    releaseDate: '2026-10-16',
    poster: 'aZEKuzGt7ObqoKjTM4kcMd0klYy.jpg',
    backdrop: '3aXMkyp0Pv2WGyvm2NUdtMXwY2P.jpg',
    director: 'Balaji Mohan',
    cast: ['Yami Gautam Dhar', 'Adinath Kothare', 'Sushmita Mukherjee'],
    overview:
      "A new bride turns a turbulent Meerut household into a picture of harmony, until her brother-in-law grows convinced that his seemingly perfect sister-in-law is secretly a witch.",
  },
  {
    id: 'baththa',
    tmdbId: 1515692,
    title: 'Baththa',
    language: 'Tamil',
    genres: ['Drama', 'Comedy', 'Action'],
    runtimeMinutes: 159,
    certification: null,
    rating: 8.2,
    releaseDate: '2026-10-01',
    poster: 'Ag59cmNNXCcKIBYdlmZ9HqPH9zG.jpg',
    backdrop: 'xrAtBSFEYzcRRB5kOvtICSuOrok.jpg',
    director: 'Balaji Tharaneetharan',
    cast: ['Vijay Sethupathi', 'Lijomol Jose'],
    overview:
      'In 1986 Madras, a timid eight-year-old accidentally traps a feared gangster in a deserted school toilet, and an unlikely bond grows between them.',
  },
].map((m) => ({
  ...m,
  posterUrl: `${TMDB_IMG}/w500/${m.poster}`,
  backdropUrl: `${TMDB_IMG}/w780/${m.backdrop}`,
  tmdbUrl: `https://www.themoviedb.org/movie/${m.tmdbId}`,
}));

// priceFactor scales the base ticket prices for each theatre.
const CITIES = [
  {
    slug: 'hyderabad',
    name: 'Hyderabad',
    theatres: [
      { id: 'prasads-multiplex', name: 'Prasads Multiplex', area: 'Khairatabad', priceFactor: 1.0 },
      { id: 'amb-cinemas-gachibowli', name: 'AMB Cinemas', area: 'Gachibowli', priceFactor: 1.3 },
      { id: 'allu-cinemas-kokapet', name: 'Allu Cinemas', area: 'Kokapet', priceFactor: 1.2 },
    ],
    movies: ['ranabaali', 'jailer-2', 'drishyam-the-conclusion', 'udta-teer', 'prahaar', 'nayyi-navelli'],
  },
  {
    slug: 'bengaluru',
    name: 'Bengaluru',
    theatres: [
      { id: 'inox-mall-of-asia', name: 'INOX Megaplex: Mall of Asia', area: 'Hebbal', priceFactor: 1.3 },
      { id: 'pvr-orion-mall', name: 'PVR: Orion Mall', area: 'Dr Rajkumar Road', priceFactor: 1.1 },
      { id: 'pvr-nexus-koramangala', name: 'PVR: Nexus Koramangala', area: 'Koramangala', priceFactor: 1.1 },
    ],
    movies: ['jailer-2', 'ranabaali', 'drishyam-the-conclusion', 'baththa', 'udta-teer', 'prahaar'],
  },
  {
    slug: 'chennai',
    name: 'Chennai',
    theatres: [
      { id: 'pvr-sathyam', name: 'PVR Sathyam', area: 'Royapettah', priceFactor: 1.0 },
      { id: 'pvr-palazzo', name: 'PVR: Palazzo, The Nexus Vijaya Mall', area: 'Vadapalani', priceFactor: 1.1 },
      { id: 'rohini-silver-screens', name: 'Rohini Silver Screens', area: 'Koyambedu', priceFactor: 0.7 },
    ],
    movies: ['jailer-2', 'baththa', 'ranabaali', 'drishyam-the-conclusion', 'udta-teer'],
  },
  {
    slug: 'mumbai',
    name: 'Mumbai',
    theatres: [
      { id: 'pvr-icon-phoenix-palladium', name: 'PVR ICON: Phoenix Palladium', area: 'Lower Parel', priceFactor: 1.5 },
      { id: 'pvr-icon-infiniti-mall', name: 'PVR ICON: Infiniti Mall', area: 'Andheri West', priceFactor: 1.3 },
      { id: 'maratha-mandir', name: 'Maratha Mandir', area: 'Mumbai Central', priceFactor: 0.5 },
    ],
    movies: ['drishyam-the-conclusion', 'udta-teer', 'prahaar', 'nayyi-navelli', 'jailer-2', 'ranabaali'],
  },
  {
    slug: 'delhi',
    name: 'Delhi-NCR',
    theatres: [
      { id: 'pvr-select-citywalk', name: 'PVR: Select City Walk', area: 'Saket', priceFactor: 1.3 },
      { id: 'pvr-directors-cut-ambience', name: "PVR Director's Cut: Ambience Mall", area: 'Vasant Kunj', priceFactor: 2.2 },
      { id: 'delite-cinema', name: 'Delite Cinema', area: 'Asaf Ali Road', priceFactor: 0.6 },
    ],
    movies: ['drishyam-the-conclusion', 'udta-teer', 'prahaar', 'nayyi-navelli', 'jailer-2', 'ranabaali'],
  },
];

// One screen: 8 rows x 12 seats, Classic at the front, Recliners at the back.
const LAYOUT = {
  seatsPerRow: 12,
  rows: [
    { label: 'A', tier: 'Classic' },
    { label: 'B', tier: 'Classic' },
    { label: 'C', tier: 'Classic' },
    { label: 'D', tier: 'Prime' },
    { label: 'E', tier: 'Prime' },
    { label: 'F', tier: 'Prime' },
    { label: 'G', tier: 'Prime' },
    { label: 'H', tier: 'Recliner' },
  ],
  basePriceRupees: { Classic: 180, Prime: 260, Recliner: 450 },
};

const SHOW_TIMES = ['09:30', '12:40', '15:50', '19:00', '22:15'];
const SHOW_DAYS = 3;

module.exports = { MOVIES, CITIES, LAYOUT, SHOW_TIMES, SHOW_DAYS };
