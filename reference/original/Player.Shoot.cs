// Source: Game.Logic/Phy/Object/Player.cs, lines 2416-2502
// Player.Shoot call chain

        public bool Shoot(int x, int y, int force, int angle)
        {
            if (m_game.FreeFatal && PlayerDetail.PlayerCharacter.Grade <= 15)
            {
                new FatalEffect(0, 15112004).Start(this);
            }
            if (m_shootCount == 1)
            {
                base.PetEffects.ActivePetHit = true;
            }
            if (m_shootCount > 0)
            {
                EffectTrigger = false;
                OnPlayerShoot();
                int iD = m_currentBall.ID;
                if (m_ballCount == 1 && !IsSpecialSkill && m_isBombOrIgnoreArmor == 0)
                {
                    if (Prop == 20002)
                    {
                        iD = m_MultiBallId;
                    }
                    if (Prop == 20008)
                    {
                        iD = m_AddWoundBallId;
                    }
                }
                OnPlayerAnyShellThrow();
                OnBeforePlayerShoot();
                if (IsSpecialSkill)
                {
                    ControlBall = false;
                    base.SpecialSkillDelay = 2000;
                }
                //quydeptrai
                int tmpID = iD;
                if (m_isBombOrIgnoreArmor > 0)
                {
                    if (m_isBombOrIgnoreArmor == 1)//xuyên
                    {
                        IgnoreArmor = true;
                    }
                    else if (m_isBombOrIgnoreArmor == 2)//hạt nhân
                    {
                        iD = 4;
                    }
                }

                //ts
                if (BallMgr.GetBallType(iD) == BombType.CURE)
                {
                    m_ballCount = 1;
                    ShootCount = 1;
                }
                //
                //
                if (ShootImp(iD, x, y, force, angle, m_ballCount, ShootCount))
                {
                    if (iD == 4)
                    {
                        m_game.AddAction(new FightAchievementAction(this, eFightAchievementType.SuperMansNuclearExplosion, base.Direction, 1200));
                    }
                    //quydeptrai
                    if (m_isBombOrIgnoreArmor > 0)
                    {
                        if (m_isBombOrIgnoreArmor == 1)//xuyên
                        {
                            IgnoreArmor = false;
                        }
                        else if (m_isBombOrIgnoreArmor == 2)//hạt nhân
                        {
                            iD = tmpID;
                        }
                        m_isBombOrIgnoreArmor = 0;
                    }
                    //
                    m_shootCount--;
                    if (m_shootCount <= 0 || !base.IsLiving)
                    {
                        StopAttacking();
                        AddDelay(m_currentBall.Delay + (m_weapon.isGold ? m_weapon.GoldEquip.Property8 : m_weapon.Template.Property8));
                        AddDander(20);
                        AddPetMP(10);
                        m_prop = 0;
                        if (CanGetProp)
                        {
                            int gold = 0;
                            int money = 0;