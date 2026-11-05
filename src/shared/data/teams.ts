// All team names and numbers sit in this one file, so they can be swapped.
// OFF and DEF come from real 2025 points scored and allowed (see the plan's formula).
export interface Team {
  id: string; city: string; nick: string; conf: 'AFC' | 'NFC'; division: string;
  record: string; pf: number; pa: number; off: number; def: number;
  primary: string; secondary: string;
}

const t = (id: string, city: string, nick: string, conf: 'AFC' | 'NFC', division: string, record: string, pf: number, pa: number, off: number, def: number, primary: string, secondary: string): Team =>
  ({ id, city, nick, conf, division, record, pf, pa, off, def, primary, secondary });

export const TEAMS: Team[] = [
  t('NE', 'New England', 'Patriots', 'AFC', 'East', '14-3', 490, 320, 95, 94, '#002244', '#c60c30'),
  t('BUF', 'Buffalo', 'Bills', 'AFC', 'East', '12-5', 481, 365, 94, 86, '#00338d', '#c60c30'),
  t('MIA', 'Miami', 'Dolphins', 'AFC', 'East', '7-10', 347, 424, 75, 75, '#008e97', '#fc4c02'),
  t('NYJ', 'New York', 'Jets', 'AFC', 'East', '3-14', 300, 503, 68, 61, '#125740', '#ffffff'),
  t('PIT', 'Pittsburgh', 'Steelers', 'AFC', 'North', '10-7', 397, 387, 82, 82, '#101820', '#ffb612'),
  t('BAL', 'Baltimore', 'Ravens', 'AFC', 'North', '8-9', 424, 398, 86, 80, '#241773', '#9e7c0c'),
  t('CIN', 'Cincinnati', 'Bengals', 'AFC', 'North', '6-11', 414, 492, 84, 63, '#fb4f14', '#101010'),
  t('CLE', 'Cleveland', 'Browns', 'AFC', 'North', '5-12', 279, 379, 65, 84, '#311d00', '#ff3c00'),
  t('JAX', 'Jacksonville', 'Jaguars', 'AFC', 'South', '13-4', 474, 336, 93, 91, '#006778', '#d7a22a'),
  t('HOU', 'Houston', 'Texans', 'AFC', 'South', '12-5', 404, 295, 83, 98, '#03202f', '#a71930'),
  t('IND', 'Indianapolis', 'Colts', 'AFC', 'South', '8-9', 466, 412, 92, 78, '#002c5f', '#a2aaad'),
  t('TEN', 'Tennessee', 'Titans', 'AFC', 'South', '3-14', 284, 478, 66, 66, '#0c2340', '#4b92db'),
  t('DEN', 'Denver', 'Broncos', 'AFC', 'West', '14-3', 401, 311, 83, 96, '#fb4f14', '#002244'),
  t('LAC', 'Los Angeles', 'Chargers', 'AFC', 'West', '11-6', 368, 340, 78, 90, '#0080c6', '#ffc20e'),
  t('KC', 'Kansas City', 'Chiefs', 'AFC', 'West', '6-11', 362, 328, 77, 93, '#e31837', '#ffb81c'),
  t('LV', 'Las Vegas', 'Raiders', 'AFC', 'West', '3-14', 241, 432, 60, 74, '#101010', '#a5acaf'),
  t('PHI', 'Philadelphia', 'Eagles', 'NFC', 'East', '11-6', 379, 325, 79, 93, '#004c54', '#a5acaf'),
  t('DAL', 'Dallas', 'Cowboys', 'NFC', 'East', '7-9-1', 471, 511, 92, 60, '#041e42', '#869397'),
  t('WAS', 'Washington', 'Commanders', 'NFC', 'East', '5-12', 356, 451, 76, 71, '#5a1414', '#ffb612'),
  t('NYG', 'New York', 'Giants', 'NFC', 'East', '4-13', 381, 439, 80, 73, '#0b2265', '#a71930'),
  t('CHI', 'Chicago', 'Bears', 'NFC', 'North', '11-6', 441, 415, 88, 77, '#0b162a', '#c83803'),
  t('GB', 'Green Bay', 'Packers', 'NFC', 'North', '9-7-1', 391, 360, 81, 87, '#203731', '#ffb612'),
  t('MIN', 'Minnesota', 'Vikings', 'NFC', 'North', '9-8', 344, 333, 75, 92, '#4f2683', '#ffc62f'),
  t('DET', 'Detroit', 'Lions', 'NFC', 'North', '9-8', 481, 413, 94, 77, '#0076b6', '#b0b7bc'),
  t('CAR', 'Carolina', 'Panthers', 'NFC', 'South', '8-9', 311, 380, 70, 83, '#0085ca', '#101820'),
  t('ATL', 'Atlanta', 'Falcons', 'NFC', 'South', '8-9', 353, 401, 76, 80, '#a71930', '#101010'),
  t('TB', 'Tampa Bay', 'Buccaneers', 'NFC', 'South', '8-9', 380, 411, 80, 78, '#d50a0a', '#34302b'),
  t('NO', 'New Orleans', 'Saints', 'NFC', 'South', '6-11', 306, 383, 69, 83, '#d3bc8d', '#101820'),
  t('SEA', 'Seattle', 'Seahawks', 'NFC', 'West', '14-3', 483, 292, 94, 99, '#002244', '#69be28'),
  t('SF', 'San Francisco', '49ers', 'NFC', 'West', '12-5', 437, 371, 88, 85, '#aa0000', '#b3995d'),
  t('LAR', 'Los Angeles', 'Rams', 'NFC', 'West', '12-5', 518, 346, 99, 89, '#003594', '#ffa300'),
  t('ARI', 'Arizona', 'Cardinals', 'NFC', 'West', '3-14', 355, 488, 76, 64, '#97233f', '#ffb612'),
];

export const TEAM_BY_ID: Record<string, Team> = Object.fromEntries(TEAMS.map((x) => [x.id, x]));

export const DIVISIONS: string[] = [...new Set(TEAMS.map((x) => `${x.conf} ${x.division}`))];

export function teamName(x: Team): string { return `${x.city} ${x.nick}`; }

export function formulaOff(pf: number): number { return Math.round(60 + (39 * (pf - 241)) / (518 - 241)); }
export function formulaDef(pa: number): number { return Math.round(60 + (39 * (511 - pa)) / (511 - 292)); }
