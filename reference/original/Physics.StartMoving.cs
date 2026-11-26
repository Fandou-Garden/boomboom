// Source: Game.Logic/Phy/Object/Physics.cs, lines 187-198
// Movement flag

        public virtual void StartMoving()
        {
			if (m_map != null)
			{
				m_isMoving = true;
			}
        }

        public virtual void StopMoving()
        {
			m_isMoving = false;
        }