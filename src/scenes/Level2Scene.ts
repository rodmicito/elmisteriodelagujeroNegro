import Phaser from 'phaser';
import { AudioService } from '../audio/AudioService';
import { StorageService } from '../utils/StorageService';

interface Question {
  text: string;
  options: string[];
  correct: number;
  explanation: string;
}

export class Level2Scene extends Phaser.Scene {
  private probe!: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  
  private planetX = 800;
  private planetY = 400;
  private gravityStrength = 10000;
  
  private asteroids!: Phaser.Physics.Arcade.Group;
  private timeSurvived = 0;
  private survivalTimer!: Phaser.Time.TimerEvent;
  private timeText!: Phaser.GameObjects.Text;
  private goalTime = 15; // Survive 15 seconds
  
  private activeQuestion: Question | null = null;
  private quizActive = false;
  private dialogPanel!: Phaser.GameObjects.Container;
  private currentQuestionIndex = 0;
  
  private isLeftDown = false;
  private isRightDown = false;
  private isUpDown = false;
  
  private quizQuestions: Question[] = [
    {
      text: '¿Qué tipo de estrella es nuestro Sol?',
      options: [
        'A) Enana Blanca',
        'B) Enana Amarilla',
        'C) Gigante Roja'
      ],
      correct: 1,
      explanation: '¡Correcto! El Sol es una estrella de tamaño medio clasificada como Enana Amarilla (tipo espectral G2V).'
    },
    {
      text: '¿Qué le sucederá al Sol cuando agote su combustible?',
      options: [
        'A) Se convertirá en un agujero negro.',
        'B) Explotará como supernova inmediatamente.',
        'C) Se expandirá a Gigante Roja y luego a Enana Blanca.'
      ],
      correct: 2,
      explanation: '¡Excelente! Al no tener masa suficiente para un agujero negro, el Sol crecerá a Gigante Roja y su núcleo quedará como una Enana Blanca.'
    }
  ];

  constructor() {
    super('Level2Scene');
  }

  create(): void {
    // Play deep hum for black hole
    AudioService.playBlackHoleHum();
    this.events.once('shutdown', () => {
      AudioService.stopBlackHoleHum();
    });

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.physics.world.setBounds(0, 0, width, height);

    // Dark space background with slightly red tint
    const bg = this.add.graphics();
    bg.fillStyle(0x1a0505, 1);
    bg.fillRect(0, 0, width, height);

    // Stars
    for (let i = 0; i < 100; i++) {
      this.add.circle(Phaser.Math.Between(0, width), Phaser.Math.Between(0, height), Phaser.Math.FloatBetween(0.5, 2), 0xffaaaa, Phaser.Math.FloatBetween(0.2, 0.8));
    }

    // Red Dwarf Planet
    const planetGlow = this.add.circle(this.planetX, this.planetY, 120, 0xff0000, 0.2);
    this.add.circle(this.planetX, this.planetY, 90, 0x8b0000, 1);
    
    this.tweens.add({
      targets: planetGlow,
      scale: 1.1,
      alpha: 0.3,
      duration: 2000,
      yoyo: true,
      repeat: -1
    });

    // Score display
    this.timeText = this.add.text(20, 20, `Sobrevive: ${this.goalTime}s`, {
      font: 'bold 20px "Outfit", "Inter", sans-serif',
      color: '#ffffff'
    });

    this.add.text(20, height - 40, 'Controles: Flechas para moverte. ¡Esquiva los asteroides y la gravedad de la estrella roja!', {
      font: '14px "Outfit", "Inter", sans-serif',
      color: '#ff8888'
    });

    // Exit to Menu button
    const exitBtn = this.add.text(width - 20, 20, '✖ SALIR', {
      font: 'bold 16px "Outfit", "Inter", sans-serif',
      color: '#ff5555',
      backgroundColor: '#220000',
      padding: { x: 10, y: 5 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    exitBtn.on('pointerover', () => exitBtn.setColor('#ffffff'));
    exitBtn.on('pointerout', () => exitBtn.setColor('#ff5555'));
    exitBtn.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('MainMenuScene');
      });
    });

    this.probe = this.physics.add.image(100, height / 2, 'player_probe');
    this.probe.setCollideWorldBounds(true);
    this.probe.setDamping(true);
    this.probe.setDrag(0.95);
    this.probe.setMaxVelocity(350);

    // Asteroids
    this.asteroids = this.physics.add.group();
    
    // Generate asteroids periodically
    this.time.addEvent({
      delay: 800,
      loop: true,
      callback: () => {
        if (!this.quizActive) {
          this.spawnAsteroid();
        }
      }
    });

    // Keyboard controls
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();

      // Atajo: P pasa el nivel al instante (para pruebas)
      this.input.keyboard.addKey('P').on('down', () => {
        if (!this.quizActive) {
          this.quizActive = true;  // detiene la nave y los asteroides
          this.completeLevel();
        }
      });
    }

    // Collisions
    this.physics.add.overlap(this.probe, this.asteroids, this.hitAsteroid, undefined, this);

    // Survival timer
    this.survivalTimer = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (!this.quizActive) {
          this.timeSurvived++;
          const remaining = this.goalTime - this.timeSurvived;
          if (remaining > 0) {
            this.timeText.setText(`Sobrevive: ${remaining}s`);
          } else {
            this.timeText.setText('¡Sobreviviste!');
            this.startQuiz();
          }
        }
      }
    });

    this.createDialogPanel();
    this.createMobileControls();
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
        fontSize: '24px',
        color: '#ffffff',
        fontStyle: 'bold'
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

    drawButton(70, height - 70, 0x00e5ff, '<', () => this.isLeftDown = true, () => this.isLeftDown = false);
    drawButton(170, height - 70, 0x00e5ff, '>', () => this.isRightDown = true, () => this.isRightDown = false);
    drawButton(width - 70, height - 70, 0xffa500, '^', () => this.isUpDown = true, () => this.isUpDown = false);
  }

  private spawnAsteroid(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    
    // Spawn from top or right
    let startX = width + 50;
    let startY = Phaser.Math.Between(0, height);
    
    if (Math.random() > 0.5) {
      startX = Phaser.Math.Between(0, width);
      startY = -50;
    }

    // Create a temporary graphic for the asteroid if texture not loaded
    const astG = this.make.graphics();
    astG.fillStyle(0x7f8c8d, 1);
    
    // Draw an irregular polygon for asteroid
    astG.fillPoints([
      { x: 0, y: 15 }, { x: 10, y: 5 }, { x: 25, y: 0 },
      { x: 35, y: 10 }, { x: 40, y: 25 }, { x: 25, y: 35 },
      { x: 5, y: 30 }
    ], true);
    astG.generateTexture('asteroid_tex', 40, 40);

    const asteroid = this.asteroids.create(startX, startY, 'asteroid_tex') as Phaser.Physics.Arcade.Image;
    
    // Target somewhere around the player or bottom left
    const targetX = Phaser.Math.Between(-100, this.probe.x + 100);
    const targetY = Phaser.Math.Between(this.probe.y - 100, height + 100);
    
    const angle = Phaser.Math.Angle.Between(startX, startY, targetX, targetY);
    const speed = Phaser.Math.Between(150, 300);
    
    asteroid.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    asteroid.setAngularVelocity(Phaser.Math.Between(-100, 100));
    
    // Destroy after 8 seconds to free memory
    this.time.delayedCall(8000, () => {
      if (asteroid.active) asteroid.destroy();
    });
  }

  update(): void {
    if (this.quizActive) {
      this.probe.setVelocity(0);
      return;
    }

    // 1. Apply Gravitational Pull towards the Red Planet
    const dx = this.planetX - this.probe.x;
    const dy = this.planetY - this.probe.y;
    const distanceSq = dx * dx + dy * dy;
    const distance = Math.sqrt(distanceSq);

    if (distance < 90) {
      // Hit the planet! Reset
      AudioService.playSFX('incorrect');
      this.cameras.main.flash(500, 255, 0, 0);
      this.resetLevel();
      return;
    }

    if (distance < 500) {
      const force = this.gravityStrength / distanceSq;
      const accelX = (dx / distance) * force * 100;
      const accelY = (dy / distance) * force * 100;
      this.probe.setAcceleration(accelX, accelY);
    } else {
      this.probe.setAcceleration(0, 0);
    }

    // 2. Player Input Handling
    const controlType = this.registry.get('controlType') || 'keyboard';
    const speed = 250;

    // Con toque/mouse presionado se sigue el dedo; si no, flechas (teclado o guante)
    if (controlType === 'pointer' && this.input.activePointer.isDown) {
      this.probe.setAngularVelocity(0);
      const pointer = this.input.activePointer;
      if (pointer.isDown) {
        const targetAngle = Phaser.Math.Angle.Between(this.probe.x, this.probe.y, pointer.x, pointer.y) + Math.PI/2;
        let diff = Phaser.Math.Angle.Wrap(targetAngle - this.probe.rotation);
        
        this.probe.setAngularVelocity(diff * 300);
        this.physics.velocityFromRotation(this.probe.rotation - Math.PI/2, speed, this.probe.body.velocity);
      }
    } else {
      let moveLeft = this.isLeftDown;
      let moveRight = this.isRightDown;
      let moveUp = this.isUpDown;

      if (this.cursors) {
        if (this.cursors.left.isDown) moveLeft = true;
        if (this.cursors.right.isDown) moveRight = true;
        if (this.cursors.up.isDown) moveUp = true;
      }

      if (moveLeft) {
        this.probe.setAngularVelocity(-250);
      } else if (moveRight) {
        this.probe.setAngularVelocity(250);
      } else {
        this.probe.setAngularVelocity(0);
      }

      if (moveUp) {
        this.physics.velocityFromRotation(this.probe.rotation - Math.PI/2, speed, this.probe.body.velocity);
      }
    }
  }

  private hitAsteroid(_probeObj: any, astObj: any): void {
    AudioService.playSFX('incorrect');
    this.cameras.main.flash(500, 255, 0, 0);
    this.resetLevel();
  }

  private resetLevel(): void {
    this.probe.setPosition(100, this.cameras.main.height / 2);
    this.probe.setVelocity(0);
    this.probe.setAcceleration(0, 0);
    this.probe.setRotation(0);
    
    this.timeSurvived = 0;
    this.timeText.setText(`Sobrevive: ${this.goalTime}s`);
    
    // Destroy existing asteroids
    this.asteroids.clear(true, true);
  }

  private createDialogPanel(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.dialogPanel = this.add.container(0, 0);
    this.dialogPanel.setVisible(false);
    this.dialogPanel.setDepth(100);

    const backdrop = this.add.graphics();
    backdrop.fillStyle(0x000000, 0.7);
    backdrop.fillRect(0, 0, width, height);
    this.dialogPanel.add(backdrop);

    const modalBg = this.add.graphics();
    modalBg.fillStyle(0x130d2d, 0.95);
    modalBg.lineStyle(4, 0xffa500, 1);
    modalBg.fillRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    modalBg.strokeRoundedRect(width / 2 - 350, height / 2 - 200, 700, 400, 15);
    this.dialogPanel.add(modalBg);
  }

  private startQuiz(): void {
    this.asteroids.clear(true, true);
    this.currentQuestionIndex = 0;
    this.showQuizQuestion(this.quizQuestions[this.currentQuestionIndex]);
  }

  private showQuizQuestion(q: Question): void {
    this.activeQuestion = q;
    this.quizActive = true;
    this.probe.setVelocity(0);

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    while (this.dialogPanel.list.length > 2) {
      this.dialogPanel.list[2].destroy();
    }

    const qText = this.add.text(width / 2, height / 2 - 160, q.text, {
      fontSize: '36px',
      fontFamily: 'Outfit, sans-serif',
      fontStyle: 'bold',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 660 }
    }).setOrigin(0.5);
    // Add subtle shadow to stand out more
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
        btnG.clear();
        btnG.fillStyle(0x3e2c7a, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
      });

      btnZone.on('pointerout', () => {
        btnG.clear();
        btnG.fillStyle(0x281c4e, 1);
        btnG.fillRoundedRect(width / 2 - 280, yPos - 22, 560, 44, 8);
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

    const feedbackText = this.add.text(width / 2, height / 2 - 60, isCorrect ? '¡RESPUESTA CORRECTA!' : 'RESPUESTA INCORRECTA', {
      font: 'bold 32px "Outfit", sans-serif',
      color: isCorrect ? '#00e676' : '#ff1744',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(feedbackText);

    const explanationText = this.add.text(width / 2, height / 2 + 10, isCorrect ? this.activeQuestion.explanation : 'Atención cadete: El Sol es una enana amarilla y al morir crecerá a Gigante Roja para luego colapsar a Enana Blanca.', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(explanationText);

    const btnContinue = this.add.graphics();
    btnContinue.fillStyle(isCorrect ? 0x00e676 : 0xff1744, 1);
    btnContinue.fillRoundedRect(width / 2 - 100, height / 2 + 100, 200, 44, 8);
    this.dialogPanel.add(btnContinue);

    const btnText = this.add.text(width / 2, height / 2 + 122, isCorrect ? 'CONTINUAR' : 'REINTENTAR', {
      font: 'bold 18px "Outfit", sans-serif',
      color: '#ffffff'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const continueZone = this.add.zone(width / 2, height / 2 + 122, 200, 44).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(continueZone);

    continueZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);

      if (!isCorrect) {
        // Retry the whole level
        this.quizActive = false;
        this.resetLevel();
      } else {
        this.currentQuestionIndex++;
        if (this.currentQuestionIndex < this.quizQuestions.length) {
          this.showQuizQuestion(this.quizQuestions[this.currentQuestionIndex]);
        } else {
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

    StorageService.setCurrentLevel(3);
    StorageService.unlockBadge('navegante'); // Navigator badge
    AudioService.playSFX('achievement');

    const winTitle = this.add.text(width / 2, height / 2 - 100, '¡NIVEL COMPLETADO!', {
      font: 'bold 36px "Outfit", sans-serif',
      color: '#ffc107',
      align: 'center'
    }).setOrigin(0.5);
    this.dialogPanel.add(winTitle);

    const winDesc = this.add.text(width / 2, height / 2 - 10, 'Has sobrevivido a la tormenta de asteroides y demostrado tu conocimiento estelar.\n\n¡Ganaste la insignia "Navegante Experto"!', {
      font: '20px "Outfit", sans-serif',
      color: '#ffffff',
      align: 'center',
      wordWrap: { width: 600 }
    }).setOrigin(0.5);
    this.dialogPanel.add(winDesc);

    const btnMenu = this.add.graphics();
    btnMenu.fillStyle(0x00e5ff, 1);
    btnMenu.fillRoundedRect(width / 2 - 120, height / 2 + 100, 240, 48, 8);
    this.dialogPanel.add(btnMenu);

    const btnText = this.add.text(width / 2, height / 2 + 124, 'SIGUIENTE NIVEL', {
      font: 'bold 16px "Outfit", sans-serif',
      color: '#130d2d'
    }).setOrigin(0.5);
    this.dialogPanel.add(btnText);

    const menuZone = this.add.zone(width / 2, height / 2 + 124, 240, 48).setInteractive({ useHandCursor: true });
    this.dialogPanel.add(menuZone);

    menuZone.on('pointerdown', () => {
      AudioService.playSFX('click');
      this.dialogPanel.setVisible(false);
      this.cameras.main.fadeOut(400, 10, 5, 27);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Level3Scene');
      });
    });

    this.dialogPanel.setVisible(true);
  }
}
