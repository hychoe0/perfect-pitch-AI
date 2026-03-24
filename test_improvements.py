import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'api'))
from perfect_pitch_core import PerfectPitchAI

ai = PerfectPitchAI()
ai.load_matchup('Tyler Glasnow', 'Juan Soto')
ai.start_at_bat(inning=7, outs=1, on_base='_2_', home_score=2, away_score=2, game_type='W')
recs = ai.get_recommendation(top_n=5)
for r in recs:
    print(f"{r['pitch_type']} → Zone {r['zone']} | Score: {r['score']:.1f} | {r.get('ml_prob',0):.2f}")
    for reason in r['reasons']:
        print(f"    {reason}")