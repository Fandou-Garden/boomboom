// Source: Game.Logic/BaseGame.cs, lines 1476-1501
// GetNextWind exact branch logic

		public float GetNextWind()
		{
			if (FrozenWind)
			{
				return 0f;
			}
			int num = (int)(Wind * 10f);
			int num2;
			if (num > m_nextWind)
			{
				num2 = num - m_random.Next(11);
				if (num <= m_nextWind)
				{
					m_nextWind = m_random.Next(-40, 40);
				}
			}
			else
			{
				num2 = num + m_random.Next(11);
				if (num >= m_nextWind)
				{
					m_nextWind = m_random.Next(-40, 40);
				}
			}
			return (float)num2 / 10f;
		}