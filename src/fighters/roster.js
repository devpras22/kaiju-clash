// OWNER: core (stable). Identity data only. Combat stats live in src/combat/moves.js, visuals in src/fighters/models/.
export const ROSTER = [
  {
    id: 'saurian',
    name: 'GODZILLA',
    title: 'King of the Monsters',
    blurb: 'A radioactive leviathan risen from the ocean trench. Slow, armored, and devastating at range with its atomic breath.',
    color: '#39b6ff', // UI accent (atomic blue)
    stats: { power: 5, speed: 2, defense: 5, range: 5 },
  },
  {
    id: 'ape',
    name: 'KING KONG',
    title: 'Eighth Wonder of the World',
    blurb: 'A colossal primate of impossible strength. Fast, agile, and brutal up close — it tears the city apart to use as weapons.',
    color: '#ff7a2f', // UI accent (fire orange)
    stats: { power: 5, speed: 5, defense: 3, range: 2 },
  },
];
export const getFighterDef = (id) => ROSTER.find((f) => f.id === id);
