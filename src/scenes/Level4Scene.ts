import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { StorageService } from '../utils/StorageService';

interface Question {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

export class Level4Scene extends Phaser.Scene {
  private probe!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  private anomalies!: Phaser.Physics.Arcade.Group;
  private speedLines: Phaser.GameObjects.Rectangle[] = [];
  
  private timeSurvived = 0;
  private survivalTimer!: Phaser.Time.TimerEvent;
  private spawnTimer!: Phaser.Time.TimerEvent;
  private timeText!: Phaser.GameObjects.Text;
  private goalTime = 10; // 10 seconds survival

  private activeQuestion: Question | null = null;
  private quizActive = false;
  private dialogPanel!: Phaser.GameObjects.Container;
  private currentQuestionIndex = 0;

  private isLeftDown = false;
  private isRightDown = false;

  private quizQuestions: Question[] = [
    {
      text: 'Que es teoricamente un agujero de gusano?',
      options: [
        'A) Un atajo a traves del espacio-tiempo.',
        'B) Un tipo especial de estrella fugaz.',
        'C) El centro absoluto del universo.'
      ],
      correct: 0,
      explanation: 'Correcto. Segun la Relatividad General, seria un puente de Einstein-Rosen que conecta dos puntos distantes del espacio-tiempo.'
    },
    {
      text: 'Si viajas cerca de la velocidad de la luz, que le ocurre al tiempo para ti en comparacion con la Tierra?',
      options: [
        'A) El tiempo pasa mas rapido.',
        'B) El tiempo pasa mas lento.',
        'C) El tiempo se detiene por completo.'
      ],
      correct: 1,
      explanation: 'Excelente. Esto se conoce como dilatacion temporal. Para ti, el tiempo pasa mas lento que para observadores estacionarios.'
    }
  ];

  constructor() {
    super('Level4Scene');
  }

  create(): void {
    AudioService.playBlackHoleHum();
    this.events.once('shutdown', () => {
      AudioService.stopBlackHoleHum();
    });

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.physics.world.setBounds(0, 0, width, height);

    // Deep purple background
    const bg = this.add.graphics();
    bg.fillStyle(0x130026, 1);
    bg.fillRect(0, 0, width, height);

    // Speed lines for illusion of moving forward fast
    for (let i = 0; i < 20; i++) {
      const line = this.add.rectangle(
        Phaser.Math.Between(0, width),
        Phaser.Math.Between(0, height),
        2,
        Phaser.Math.Between(20, 100),
        0x00e5ff,
        0.5
      );
      this.speedLines.push(line);
    }

    // UI
    this.add.text(20, height - 40, 'Esquiva las anomalias rojas. Solo izquierda y derecha.', {
      font: '14px "Outfit", "Inter", sans-serif',
      color: '#b3e5fc'
    });

    this.timeText = this.add.text(20, 20, `Viaje: ${this.goalTime}s restantes`, {
      font: 'bold 24px "Outfit", "Inter", sans-serif',
      color: '#ffffff'
    });

    const exitBtn = this.add.text(width - 20, 20, 'SALIR', {
      font: 'bold 16px "Outfit", "Inter", sans-serif',
      color: '#ff5555',
      backgroundColor: '#220000',
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    exitBtn.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.scene.start('MainMenuScene');
    });

    // Probe
    this.probe = this.physics.add.image(width / 2, height - 100, 'player_probe');
    this.probe.setCollideWorldBounds(true);
    this.probe.setDamping(true);
    this.probe.setDrag(0.9); // high drag for snappy stops
    this.probe.setMaxVelocity(500);

    // Anomalies group
    this.anomalies = this.physics.add.group();

    this.physics.add.overlap(this.probe, this.anomalies, this.handleHitAnomaly, undefined, this);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      const pKey = this.input.keyboard.addKey('P');
      pKey.on('down', () => {
        if (!this.quizActive) {
          this.timeText.setText('Tunel saltado.');
          this.completeLevel();
        }
      });
    }

    // Timer
    this.survivalTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.quizActive) {
          this.timeSurvived++;
          const remaining = this.goalTime - this.timeSurvived;
          if (remaining > 0) {
            this.timeText.setText(`Viaje: ${remaining}s restantes`);
            // Trigger quiz at half time
            if (remaining === Math.floor(this.goalTime / 2) && this.currentQuestionIndex === 0) {
              this.startQuiz();
            }
          } else {
            this.timeText.setText('Tunel atravesado.');
            if (this.currentQuestionIndex === 1) {
              this.startQuiz();
            } else {
              this.completeLevel();
            }
          }
        }
      }
    });

    // Spawn anomalies
    this.spawnTimer = this.time.addEvent({
      delay: 800,
      loop: true,
      callback: () => {
        if (!this.quizActive) {
          this.spawnAnomaly();
        }
      }
    });

    this.createDialogPanel();
    this.createMobileControls();
  }

  private spawnAnomaly() {
    const width = this.cameras.main.width;
    const x = Phaser.Math.Between(50, width - 50);
    
    // Create a red circle graphic as texture
    const graphics = this.add.graphics();
    graphics.fillStyle(0xff1744, 0.8);
    graphics.fillCircle(20, 20, 20);
    graphics.generateTexture('anomaly_tex', 40, 40);
    graphics.destroy();

    const anomaly = this.anomalies.create(x, -50, 'anomaly_tex') as Phaser.Physics.Arcade.Image;
    anomaly.setCircle(20);
    anomaly.setVelocityY(Phaser.Math.Between(300, 500));
    
    // Destroy if out of bounds
    this.time.delayedCall(4000, () => {
      if (anomaly.active) anomaly.destroy();
    });
  }

  private createMobileControls(): void {
    if (this.registry.get('controlType') !== 'virtual_buttons') return;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const controls = this.add.container(0, 0);
    controls.setDepth(50);

    const drawButton = (x: number, y: number, color: number, text: string, callbackDown: () => void, callbackUp: () => void) => {
      const btn = this.add.graphics();
      btn.fillStyle(color, 0.4);
      btn.fillCircle(x, y, 40);
      btn.lineStyle(2, color, 0.8);
      btn.strokeCircle(x, y, 40);
      controls.add(btn);

      const label = this.add.text(x, y, text, {
        fontSize: '24px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);
      controls.add(label);

      const zone = this.add.zone(x, y, 80, 80).setInteractive();
      controls.add(zone);

      zone.on('pointerdown', () => {
        btn.clear();
        btn.fillStyle(color, 0.7);
        btn.fillCircle(x, y, 40);
        btn.lineStyle(2, color, 1);
        btn.strokeCircle(x, y, 40);
        callbackDown();
      });
      const resetBtn = () => {
        btn.clear();
        btn.fillStyle(color, 0.4);
        btn.fillCircle(x, y, 40);
        btn.lineStyle(2, color, 0.8);
        btn.strokeCircle(x, y, 40);
        callbackUp();
      };
      zone.on('pointerup', resetBtn);
      zone.on('pointerout', resetBtn);
    };

    // Left and Right only
    drawButton(80, height - 80, 0x00e5ff, '<', () => this.isLeftDown = true, () => this.isLeftDown = false);
    drawButton(width - 80, height - 80, 0x00e5ff, '>', () => this.isRightDown = true, () => this.isRightDown = false);
  }

  update(): void {
    if (this.quizActive) {
      this.probe.setVelocity(0);
      return;
    }

    const height = this.cameras.main.height;

    // Animate speed lines
    this.speedLines.forEach(line => {
      line.y += 15;
      if (line.y > height + 50) {
        line.y = -50;
        line.x = Phaser.Math.Between(0, this.cameras.main.width);
      }
    });

    // Enforce Y position
    this.probe.y = height - 100;
    this.probe.setVelocityY(0);

    // Player Input Handling (Left/Right only)
    const controlType = this.registry.get('controlType') || 'keyboard';
    const speed = 1000;
    let ax = 0;

    // Con toque/mouse presionado se sigue el dedo; si no, flechas (teclado o guante)
    if (controlType === 'pointer' && this.input.activePointer.isDown) {
      const pointer = this.input.activePointer;
      if (pointer.isDown) {
        // Move towards pointer X
        const diff = pointer.x - this.probe.x;
        if (Math.abs(diff) > 10) {
          ax = Math.sign(diff) * speed;
        }
      }
    } else {
      let moveLeft = this.isLeftDown;
      let moveRight = this.isRightDown;

      if (this.cursors) {
        if (this.cursors.left.isDown) moveLeft = true;
        if (this.cursors.right.isDown) moveRight = true;
      }

      if (moveLeft) ax -= speed;
      if (moveRight) ax += speed;
    }

    this.probe.setAccelerationX(ax);
      
    // Tilt probe based on movement
    if (ax !== 0) {
      const tilt = Math.sign(ax) * 0.2;
      this.probe.setRotation(tilt);
    } else {
      this.probe.setRotation(0);
    }
  }

  private handleHitAnomaly(_probeObj: any, anomalyObj: any): void {
    AudioService.playSFX('incorrect');
    this.cameras.main.flash(400, 255, 0, 0);
    anomalyObj.destroy();
    
    // Penalize time by 2 seconds
    this.timeSurvived = Math.max(0, this.timeSurvived - 2);
    const remaining = this.goalTime - this.timeSurvived;
    this.timeText.setText(`Viaje: ${remaining}s restantes`);
  }

  private resetLevel(): void {
    this.probe.setPosition(this.cameras.main.width / 2, this.cameras.main.height - 100);
    this.probe.setVelocity(0);
    this.probe.setAcceleration(0, 0);
    
    this.anomalies.clear(true, true);

    this.timeSurvived = 0;
    this.timeText.setText(`Viaje: ${this.goalTime}s restantes`);
    this.quizActive = false;
  }

  private createDialogPanel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.dialogPanel = this.add.container(0, 0);
    this.dialogPanel.setVisible(false);
    this.dialogPanel.setDepth(100);

    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.8);
    backdrop.fillRect(0, 0, width, height);
    this.dialogPanel.add(backdrop);

    const modalBg = this.add.graphics();
    modalBg.fillStyle(0x130d2d, 0.95);
    modalBg.lineStyle(4, 0x00e5ff, 1);
    modalBg.fillRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    modalBg.strokeRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    this.dialogPanel.add(modalBg);
  }

  private startQuiz(): void {
    this.quizActive = true;
    this.probe.setVelocity(0);
    this.showQuizQuestion(this.quizQuestions[this.currentQuestionIndex]);
  }

  private showQuizQuestion(q: Question): void {
    this.activeQuestion = q;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const qText = this.add.text(width / 2, height / 2 - 160, q.text, {
      fontSize: '36px', fontFamily: 'Outfit, sans-serif', fontStyle: 'bold', color: '#ffffff',
      align: 'center', wordWrap: { width: 660 }
    }).setOrigin(0.5);
    qText.setShadow(2, 2, '#000000', 4, true, true);
    this.dialogPanel.add(qText);

    q.options.forEach((opt, idx) => {
      const yPos = height / 2 - 40 + (idx * 60);

      const btnG = this.add.graphics();
      btnG.fillStyle(0x281c4e, 1);
      btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      this.dialogPanel.add(btnG);

      const btnT = this.add.text(width / 2 - 260, yPos, opt, {
        fontSize: '17px',
        fontFamily: 'Outfit, sans-serif',
        fontStyle: 'bold',
        color: '#ffc107'
      }).setOrigin(0, 0.5);
      this.dialogPanel.add(btnT);

      const btnZone = this.add.zone(width / 2, yPos, 560, 44).setInteractive({ useHandCursor: true });
      this.dialogPanel.add(btnZone);

      btnZone.on('pointerover', () => {
        btnG.clear(); btnG.fillStyle(0x3e2c7a, 1); btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerout', () => {
        btnG.clear(); btnG.fillStyle(0x281c4e, 1); btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerdown', () => {
        this.selectAnswer(idx);
      });
    });

    this.dialogPanel.setVisible(true);
  }

  private selectAnswer(index: number): void {
    if (!this.activeQuestion) return;

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const isCorrect = index === this.activeQuestion.correct;

    AudioService.playSFX(isCorrect ? 'correct' : 'incorrect');

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const feedbackText = this.add.text(width / 2, height / 2 - 60, isCorrect ? 'RESPUESTA CORRECTA' : 'RESPUESTA INCORRECTA', {
      font: 'bold 32px "Outfit", sans-serif', color: isCorrect ? '#00e676' : '#ff1744', align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(feedbackText);

    const explanationText = this.add.text(width / 2, height / 2 + 10, isCorrect ? this.activeQuestion.explanation : 'Incorrecto. Es un puente teorico de espacio-tiempo. Intentalo de nuevo.', {
      font: '20px "Outfit", sans-serif', color: '#ffffff', align: 'center', wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(explanationText);

    const btnContinue = this.add.graphics();
    btnContinue.fillStyle(isCorrect ? 0x00e676 : 0xff1744, 1);
    btnContinue.fillRoundedRect(width / 2 - 100, height / 2 + 100, 200, 44, 8);
    this.dialogPanel.add(btnContinue);

    const btnText = this.add.text(width / 2, height / 2 + 122, isCorrect ? 'CONTINUAR' : 'REINTENTAR', {
      font: 'bold 18px "Outfit", sans-serif', color: '#ffffff'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const continueZone = this.add.zone(width / 2, height / 2 + 122, 200, 44).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(continueZone);

    continueZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);

      if (!isCorrect) {
        this.resetLevel();
      } else {
        this.currentQuestionIndex++;
        this.quizActive = false;
        
        if (this.currentQuestionIndex >= this.quizQuestions.length) {
          this.completeLevel();
        }
      }
    });
  }

  private completeLevel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    StorageService.setCurrentLevel(5);
    StorageService.unlockBadge('viajero');
    AudioService.playSFX('achievement');

    const winTitle = this.add.text(width / 2, height / 2 - 90, '¡NIVEL COMPLETADO!', {
      fontSize: '36px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(winTitle);

    const winDesc = this.add.text(width / 2, height / 2 - 10, '¡Has atravesado el Agujero de Gusano con éxito!\n\nGanaste la insignia "Viajero del Tiempo".', {
      fontSize: '20px',
      fontFamily: 'Outfit, sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(winDesc);

    const btnMenu = this.add.graphics();
    btnMenu.fillStyle(0x00e5ff, 1);
    btnMenu.fillRoundedRect(width / 2 - 120, height / 2 + 105, 240, 48, 8);
    this.dialogPanel.add(btnMenu);

    const btnText = this.add.text(width / 2, height / 2 + 129, 'IR AL NIVEL 5', {
      fontSize: '18px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#130d2d'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const menuZone = this.add.zone(width / 2, height / 2 + 129, 240, 48).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(menuZone);

    menuZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.scene.start('Level5Scene');
    });

    this.dialogPanel.setVisible(true);
  }
}

