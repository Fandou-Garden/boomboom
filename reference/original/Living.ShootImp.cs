// Source: Game.Logic/Living.cs, lines 1768-1839
// Launch force/angle conversion

    public bool ShootImp(int bombId, int x, int y, int force, int angle, int bombCount, int shootCount)
    {
        BallInfo ballInfo = BallMgr.FindBall(bombId);
        Tile shape = BallMgr.FindTile(bombId);
        BombType ballType = BallMgr.GetBallType(bombId);
        int num = (int)((double)m_map.wind * 10.0);
        if (ballInfo == null)
        {
            return false;
        }
        GSPacketIn gSPacketIn = new GSPacketIn(91, base.Id);
        gSPacketIn.Parameter1 = base.Id;
        gSPacketIn.WriteByte(2);
        gSPacketIn.WriteInt(num);
        gSPacketIn.WriteBoolean(num > 0);
        gSPacketIn.WriteByte(m_game.GetVane(num, 1));
        gSPacketIn.WriteByte(m_game.GetVane(num, 2));
        gSPacketIn.WriteByte(m_game.GetVane(num, 3));
        gSPacketIn.WriteInt(bombCount);
        float num2 = 0f;
        SimpleBomb simpleBomb = null;
        for (int i = 0; i < bombCount; i++)
        {
            double num3 = 1.0;
            int num4 = 0;
            switch (i)
            {
                case 2:
                    num3 = 1.1;
                    num4 = 5;
                    break;
                case 1:
                    num3 = 0.9;
                    num4 = -5;
                    break;
            }
            int num5 = (int)((double)force * num3 * Math.Cos((double)(angle + num4) / 180.0 * Math.PI));
            int num6 = (int)((double)force * num3 * Math.Sin((double)(angle + num4) / 180.0 * Math.PI));
            BaseGame game = m_game;
            SimpleBomb simpleBomb2 = new SimpleBomb(game.PhysicalId++, ballType, this, m_game, ballInfo, shape, ControlBall, angle);
            simpleBomb2.SetXY(x, y);
            simpleBomb2.setSpeedXY(num5, num6);
            totalShotTurn = ((totalShotTurn == 0) ? (bombCount * shootCount) : totalShotTurn);
            m_map.AddPhysical(simpleBomb2);
            simpleBomb2.StartMoving();
            if (i == 0)
            {
                simpleBomb = simpleBomb2;
            }
            gSPacketIn.WriteInt(bombCount);
            gSPacketIn.WriteInt(shootCount);
            gSPacketIn.WriteBoolean(simpleBomb2.DigMap);
            gSPacketIn.WriteInt(simpleBomb2.Id);
            gSPacketIn.WriteInt(x);
            gSPacketIn.WriteInt(y);
            gSPacketIn.WriteInt(num5);
            gSPacketIn.WriteInt(num6);
            gSPacketIn.WriteInt(simpleBomb2.BallInfo.ID);
            if (FlyingPartical != 0)
            {
                gSPacketIn.WriteString(FlyingPartical.ToString());
            }
            else
            {
                gSPacketIn.WriteString(ballInfo.FlyingPartical);
            }
            gSPacketIn.WriteInt(simpleBomb2.BallInfo.Radii * 1000 / 4);
            gSPacketIn.WriteInt((int)simpleBomb2.BallInfo.Power * 1000);
            gSPacketIn.WriteInt(simpleBomb2.Actions.Count);
            foreach (BombAction action in simpleBomb2.Actions)
            {
                gSPacketIn.WriteInt(action.TimeInt);