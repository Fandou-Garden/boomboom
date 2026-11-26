// Source: Game.Logic/PVPGame.cs, lines 590-635
// Wind updated when next living starts turn

        public void NextTurn()
        {
            if (base.GameState != eGameState.Playing)
            {
                return;
            }
            ClearWaitTimer();
            ClearDiedPhysicals();
            CheckBox();
            base.m_turnIndex++;
            List<Box> newBoxes = CreateBox();
            foreach (Physics item in m_map.GetAllPhysicalSafe())
            {
                item.PrepareNewTurn();
            }
            LastTurnLiving = m_currentLiving;
            m_currentLiving = FindNextTurnedLiving();
            if (m_currentLiving.VaneOpen)
            {
                UpdateWind(GetNextWind(), sendToClient: false);
            }
            if (m_currentLiving is Player && (m_currentLiving as Player).PlayerDetail.PlayerCharacter.NickName == ContinuousRunningPlayer)
            {
                foreach (Player allFightPlayer in GetAllFightPlayers())
                {
                    allFightPlayer.PlayerDetail.SendMessage($"Người chơi {ContinuousRunningPlayer} nhận được thêm 1 lần tấn công");
                }
            }
            MinusDelays(m_currentLiving.Delay);
            m_currentLiving.PrepareSelfTurn();
            if (!base.CurrentLiving.IsFrost && m_currentLiving.IsLiving)
            {
                m_currentLiving.StartAttacking();
                SendGameNextTurn(m_currentLiving, this, newBoxes);
                if (m_currentLiving.IsAttacking)
                {
                    AddAction(new WaitLivingAttackingAction(m_currentLiving, base.m_turnIndex, (m_timeType + 20) * 1000));
                }
            }
            //if (m_currentLiving is Player && FindNextTurnedLiving(true) is Player)
            //{
            //	ContinuousRunningPlayer = (m_currentLiving as Player).PlayerDetail.PlayerCharacter.NickName;
            //}
            ContinuousRunningPlayer = (m_currentLiving as Player).PlayerDetail.PlayerCharacter.NickName;
            OnBeginNewTurn();
        }